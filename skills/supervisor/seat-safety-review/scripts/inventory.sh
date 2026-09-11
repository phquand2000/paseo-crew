#!/bin/sh
# Print a secret-free inventory of the seats for the seat safety review.
#
# Run it from the kit root: sh skills/supervisor/seat-safety-review/scripts/inventory.sh
# It prints names, flags, and presence only. Env var values and file contents are left out on
# purpose, because this output lands in transcripts and in records/safety/seat-matrix.md.
#
# Overrides: PASEO_CONFIG, PI_PROFILES, CLAUDE_PROFILES, KIT.

set -u

config="${PASEO_CONFIG:-$HOME/.paseo/config.json}"
pi_profiles="${PI_PROFILES:-$HOME/.pi/profiles}"
claude_profiles="${CLAUDE_PROFILES:-$HOME/.claude/profiles}"
kit="${KIT:-$PWD}"

command -v jq >/dev/null 2>&1 || { echo "jq must be on PATH" >&2; exit 1; }

section() { printf '\n## %s\n' "$1"; }

section "Paseo providers ($config)"
if [ -f "$config" ]; then
    # jq's // treats false as missing, so test with has() where false is a meaningful value.
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

section "Kit deny lists (setup/setup-seats.fish)"
if [ -f "$kit/setup/setup-seats.fish" ]; then
    grep -n -A2 '^set -[gl] deny_' "$kit/setup/setup-seats.fish"
else
    echo "not found; run from the kit root or set KIT"
fi

section "Peer guard patterns (pi/extensions/peer-guard.ts)"
if [ -f "$kit/pi/extensions/peer-guard.ts" ]; then
    grep -n -B1 'pattern:' "$kit/pi/extensions/peer-guard.ts" | grep '//' || echo "no commented patterns found"
else
    echo "not found"
fi

peers=0
for peer_dir in "$pi_profiles"/pi-peer-*/; do
    [ -d "$peer_dir" ] || continue
    peers=1
    peer_dir="${peer_dir%/}"
    section "Peer profile ($peer_dir)"
    if [ -f "$peer_dir/settings.json" ]; then
        jq -r '"packages: \((.packages // []) | map(if type == "string" then . else (.source // .name // "object") end) | join(", "))"' "$peer_dir/settings.json"
    else
        echo "settings.json: missing"
    fi
    if [ -f "$peer_dir/mcp.json" ]; then
        jq -r '"mcp servers: \((.mcpServers // {}) | keys | join(", "))"' "$peer_dir/mcp.json"
    else
        echo "mcp servers: none (no mcp.json)"
    fi
    echo "extensions: $(ls "$peer_dir/extensions" 2>/dev/null | tr '\n' ' ')"
    echo "skills: $(ls "$peer_dir/skills" 2>/dev/null | tr '\n' ' ')"
    if [ -L "$peer_dir/auth.json" ]; then
        echo "auth.json: link to $(readlink "$peer_dir/auth.json")"
    elif [ -f "$peer_dir/auth.json" ]; then
        echo "auth.json: own file"
    fi
    echo "prompt: $(readlink "$peer_dir/APPEND_SYSTEM.md" 2>/dev/null || echo "not a link")"
done
[ "$peers" -eq 1 ] || { section "Peer profiles ($pi_profiles)"; echo "none built"; }
echo "skills every Pi profile loads from ~/.agents/skills: $(ls -d "$HOME"/.agents/skills/*/ 2>/dev/null | wc -l | tr -d ' ')"

section "Claude seat profiles ($claude_profiles)"
found=0
for dir in "$claude_profiles"/*/; do
    [ -d "$dir" ] || continue
    found=1
    mcp=$(jq -r '(.mcpServers // {}) | keys | join(",")' "$dir.claude.json" 2>/dev/null || echo "unreadable")
    creds=none
    [ -e "$dir.credentials.json" ] && creds=present
    echo "$(basename "$dir")  mcp=[$mcp]  skills=[$(ls "$dir/skills" 2>/dev/null | tr '\n' ' ')]  .credentials.json=$creds"
done
[ "$found" -eq 1 ] || echo "none"

section "Credentials any seat with a shell inherits (presence only)"
if command -v gh >/dev/null 2>&1; then
    gh auth status 2>&1 | grep -E 'Logged in|Token scopes' || echo "gh: not logged in"
fi
echo "ssh agent keys: $(ssh-add -l 2>/dev/null | grep -vc 'no identities')"
for f in .aws/credentials .config/gcloud .npmrc .netrc .docker/config.json .kube/config .git-credentials; do
    [ -e "$HOME/$f" ] && echo "present: ~/$f"
done
helper=$(git config --global credential.helper 2>/dev/null) && echo "git credential.helper: $helper"

section "Network tools on PATH"
for t in curl wget nc ssh scp rsync gh npm; do
    command -v "$t" >/dev/null 2>&1 && printf '%s ' "$t"
done
echo
