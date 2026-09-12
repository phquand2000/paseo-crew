#!/bin/sh

set -u

here="${0%/*}"
[ "$here" = "$0" ] && here=.
config="${PASEO_CONFIG:-$HOME/.paseo/config.json}"
kit="${KIT:-$here/../../..}"
seats="$kit/seats.json"
sources="${SOURCES:-$here/../references/inventory-sources.json}"

command -v jq >/dev/null 2>&1 || { echo "jq must be on PATH" >&2; exit 1; }

section() { printf '\n## %s\n' "$1"; }
home_path() { printf '%s\n' "$1" | sed "s|^HOME|$HOME|"; }

section "Paseo providers ($config)"
if [ -f "$config" ]; then
    jq -r '"daemon.mcp.injectIntoAgents: \(.daemon.mcp.injectIntoAgents | tostring)"' "$config"
    jq -r '.agents.providers // {} | to_entries[] | .value as $p | [
        .key,
        "extends=\($p.extends // "-")",
        "enabled=\(if $p | has("enabled") then $p.enabled else "inherited" end)",
        "paseoTools=\(if ($p.paseoTools // {}) | has("enabled") then $p.paseoTools.enabled else "default" end)",
        "env=[\(($p.env // {}) | keys | join(","))]",
        "deny=[\(($p.disallowedTools // []) | join(","))]",
        "models=[\(($p.models // []) | map(.id) | join(","))]"
      ] | join("  ")' "$config"
else
    echo "not found"
fi

if [ ! -f "$seats" ]; then
    section "Seat map"
    echo "not found; set KIT to the kit root"
    exit 0
fi

section "Seat map (seats.json)"
jq -r '.seats[] | [
    .role,
    "harness=\(.harness)",
    "readOnly=\(.readOnly)",
    "hides=[\((.hidesWords // []) | join(","))]",
    "hidesPaths=\((.hidesPaths // []) | length)",
    "guards=[\(.guards | join(","))]",
    "extraSkills=[\(.extraSkills | join(","))]",
    "denyIntents=[\(.denyIntents | join(","))]",
    "deny=[\(.deny | join(","))]"
  ] | join("  ")' "$seats"
jq -r '"denyCommonIntents: \(.denyCommonIntents | join(", "))"' "$seats"
jq -r '.skillGates[]? | "gate: \(.seat) needs \(.skill) before \(.on)"' "$seats"

for id in $(jq -r '[.seats[].harness] | unique | .[]' "$seats"); do
    manifest="$kit/harness/$id/harness.json"
    [ -f "$manifest" ] || { section "Harness $id"; echo "no $manifest"; continue; }
    root=$(home_path "$(jq -r '.profileRoot' "$manifest")")
    section "Harness $id ($manifest)"
    jq -r '[
        "verified=\(.verified // "null")",
        "configDirEnv=\(.configDirEnv)",
        "promptFile=\(.promptFile)",
        "skillsDir=\(.skillsDir)",
        "promptComments=\(.promptComments)",
        "deny=\(.deny.mechanism)",
        "intents=[\((.deny.intents // {}) | keys | join(","))]",
        "enforcedByGuard=[\((.deny.enforcedByGuard // []) | join(","))]",
        "hookProtocol=\(.guards.hookProtocol)",
        "sharedSkillDirs=[\((.sharedSkillDirs // []) | join(","))]"
      ] | join("  ")' "$manifest"
    gdir=$(jq -r '.guards.dir' "$manifest")
    echo "guards in $gdir: $(ls "$kit/harness/$gdir" 2>/dev/null | tr '\n' ' ')"
    for f in "$kit/harness/$id/settings"/*.settings.json; do
        [ -f "$f" ] || continue
        jq -r --arg f "$(basename "$f")" '.hooks.PreToolUse[]? | "\($f): \(.matcher // "*") -> \([.hooks[]?.command] | join(", "))"' "$f"
    done
    for shared in $(jq -r '(.sharedSkillDirs // [])[]' "$manifest"); do
        dir=$(home_path "$shared")
        echo "skills every $id profile also loads from $shared: $(ls -d "$dir"/*/ 2>/dev/null | wc -l | tr -d ' ')"
    done

    found=0
    for role in $(jq -r --arg h "$id" '.seats[] | select(.harness == $h) | .role' "$seats"); do
        for dir in "$root/$role-"*/; do
            [ -d "$dir" ] || continue
            found=1
            dir="${dir%/}"
            section "Seat profile ($dir)"
            prompt=$(jq -r '.promptFile' "$manifest")
            echo "prompt: $(readlink "$dir/$prompt" 2>/dev/null || echo "not a link")"
            echo "skills: $(ls "$dir/$(jq -r '.skillsDir' "$manifest")" 2>/dev/null | tr '\n' ' ')"
            echo "guards: $(ls "$dir/$(jq -r '.guards.installTo' "$manifest")" 2>/dev/null | grep -E '\.(sh|ts)$' | tr '\n' ' ')"
            state=$(jq -r '.state.file // empty' "$manifest")
            if [ -n "$state" ] && [ -f "$dir/$state" ]; then
                echo "mcp servers: $(jq -r '(.mcpServers // {}) | keys | join(", ")' "$dir/$state" 2>/dev/null || echo unreadable)"
            else
                echo "mcp servers: none"
            fi
            [ -f "$dir/settings.json" ] &&
                jq -r '"packages: \((.packages // []) | map(if type == "string" then . else (.source // .name // "object") end) | join(", "))"' "$dir/settings.json" 2>/dev/null
            for link in $(jq -r '(.links // [])[].link' "$manifest"); do
                if [ -L "$dir/$link" ]; then
                    echo "$link: link to $(readlink "$dir/$link")"
                elif [ -e "$dir/$link" ]; then
                    echo "$link: own file"
                fi
            done
            for name in $(jq -r '(.state.forbid // [])[]' "$manifest"); do
                [ -e "$dir/$name" ] && echo "! $name is present"
            done
        done
    done
    [ "$found" -eq 1 ] || { section "Seat profiles ($root)"; echo "none built"; }
done

section "Credentials a seat with a shell inherits (presence only)"
if command -v gh >/dev/null 2>&1; then
    gh auth status 2>&1 | grep -E 'Logged in|Token scopes' || echo "gh: not logged in"
fi
echo "ssh keys: $(ssh-add -l 2>/dev/null | grep -vc 'no identities')"
helper=$(git config --global credential.helper 2>/dev/null) && echo "credential.helper: $helper"
[ -f "$sources" ] || { echo "no $sources"; exit 0; }
for f in $(jq -r '.credentialFiles[]' "$sources"); do
    [ -e "$HOME/$f" ] && echo "present: ~/$f"
done

section "Egress tools on PATH"
for t in $(jq -r '.egressTools[]' "$sources"); do
    command -v "$t" >/dev/null 2>&1 && printf '%s ' "$t"
done
echo
