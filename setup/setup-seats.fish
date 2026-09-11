#!/usr/bin/env fish
#
# setup-seats: build or refresh the profile of every seat.
#
#   claude-lead, claude-supervisor   Claude Code profiles, selected by CLAUDE_CONFIG_DIR
#   pi-peer                          Pi profile, selected by PI_CODING_AGENT_DIR
#
# Prompts and settings live in this repository. The script links them into each seat's profile
# directory, the one its Paseo provider points at, so an edit here reaches the next seat
# spawned without copying.
#
# For each Claude seat, the script:
#   1. Generates claude/<seat>.settings.json from the base settings plus the seat's overlay.
#   2. Builds ~/.claude/profiles/claude-<seat>/: CLAUDE.md, settings.json, projects, plugins,
#      and skills/ (the role's skills from skills/<seat>/, plus any extras).
#   3. Adds the seat's deny list to the `disallowedTools` of provider claude-<seat>.
#
# For the Pi seat, the script:
#   1. Builds ~/.pi/profiles/pi-peer/: APPEND_SYSTEM.md, the guard extension, a link to your
#      Pi login, settings.json, and skills/ (the skills from skills/peer/, plus any extras).
#   2. Sets `paseoTools.enabled: false` on provider pi-peer, so the Peer gets no Paseo tools.
#
# Usage:
#   fish setup/setup-seats.fish            # build or update
#   fish setup/setup-seats.fish --check    # verify only; write nothing
#
# Requires fish 3.5+ (for the `path` builtin) and jq. The script never reads credentials:
# Claude seats get their token from the provider's `env`, and the Pi seat links to the
# auth.json of your normal Pi profile.
# Rerun after `claude plugin update`: plugin skill paths contain the version number, so an
# update silently breaks the symlinks.

# ── Configuration ────────────────────────────────────────────────────────────────────

set -l repo (path resolve (path dirname (status filename))/..)
set -l base $repo/setup/seat-settings.base.json

# Claude seats. Each needs claude/<ROLE>.md, <seat>_skills, deny_<seat>, overlay_<seat>, and a
# claude-<seat> provider in ~/.paseo/config.json.
set -l claude_seats  lead supervisor
set -l profiles_root $HOME/.claude/profiles       # one CLAUDE_CONFIG_DIR per Claude seat
set -l shared_claude $HOME/.claude                # projects/ and plugins/ are shared

# The Pi seat. Its prompt, settings, and guard extension live in pi/.
set -l pi_dir      $HOME/.pi/profiles/pi-peer     # PI_CODING_AGENT_DIR of provider pi-peer
set -l pi_login    $HOME/.pi/agent/auth.json      # your normal Pi login, shared with the Peer
set -l pi_settings $repo/pi/settings.json

set -g local_skills $HOME/.agents/skills          # your own skills
set -l plugin_id    mattpocock-skills@mattpocock  # optional source of extra skills
set -l paseo_config $HOME/.paseo/config.json

# Byte budget per seat prompt. Exceeding it is an error: cut content instead of raising it.
set -g prompt_budget 16384

# Each seat gets every skill in this kit's skills/<role>/: strategy skills for the Supervisor,
# macro skills for the Lead, micro skills for the Peer. Extras add skills from the $plugin_id
# plugin or $local_skills, named by the directory that holds SKILL.md.
set -l lead_extra_skills       # for example: domain-modeling
set -l supervisor_extra_skills
set -l peer_extra_skills

# Claude tools blocked at the provider level, which is where blocking happens for Claude
# seats; a seat's `permissions.deny` only looks safe, so the base settings leave it out.
# `Bash(git push:*)` matches by prefix, so `git -C repo push` gets through. `gh` is blocked
# because pushes, pull requests, and API calls through it leave the machine, which is the
# Human's call. Pi ignores disallowedTools; pi/extensions/peer-guard.ts guards the Peer instead.
set -l deny_common '["Agent", "Task", "SlashCommand", "Workflow", "WebSearch",
                     "TodoWrite", "EnterPlanMode", "ExitPlanMode",
                     "Bash(claude:*)", "Bash(npx claude:*)", "Bash(git push:*)", "Bash(gh:*)"]'
set -l deny_lead       '["LSP"]'
set -l deny_supervisor '["LSP"]'

# Per-seat differences from the base settings. `null` removes the key.
set -l overlay_lead '{
  "outputStyle": "Concise",
  "disableBundledSkills": true,
  "askUserQuestionTimeout": "never",
  "promptCacheTtl": "1h"
}'
# Only the Supervisor keeps Claude Code's auto memory, as in the practitioner's Codex setup:
# it is the organizational memory across projects, while Leads and Peers start clean.
set -l overlay_supervisor '{
  "outputStyle": "Concise",
  "disableBundledSkills": true,
  "askUserQuestionTimeout": "never",
  "autoMemoryEnabled": true
}'

# ── Helpers ──────────────────────────────────────────────────────────────────────────

set -g errs 0
set -g linked_count 0

function fail
    echo "  ! $argv"
    set -g errs (math $errs + 1)
end

# Create (or, in check mode, only inspect) a symlink, and report a path that is occupied,
# points elsewhere, or dangles.
function seat_link --argument-names link want dry
    test $dry -eq 0; and ln -sfn $want $link
    if not test -L $link
        set -l note ""
        test -d $link; and set note " (a real directory: delete it and rerun)"
        fail "$link is not a symlink$note"
    else if test (readlink $link) != $want
        fail "$link -> "(readlink $link)" (expected $want)"
    else if not test -e $link
        fail "dangling symlink: $link -> "(readlink $link)
    end
end

# Fail a prompt over the byte budget, and note one that is nearly full.
function check_budget --argument-names file
    set -l size (wc -c <$file | string trim)
    set -l pct (math "round($size * 100 / $prompt_budget)")
    set -l name (path basename $file)
    if test $size -gt $prompt_budget
        fail "$name is $size bytes, $pct% of the $prompt_budget-byte budget. Cut it."
    else if test $pct -ge 85
        echo "  · $name is $size bytes, $pct% of the $prompt_budget-byte budget; nearly full."
    end
end

# Check that a kit skill works in both runtimes: the frontmatter name matches the directory
# (Claude Code names the command after the directory, Pi after `name`), the description is
# present and within Pi's 1,024-character limit, and the body avoids substitutions that Pi
# leaves as literal text. Peer skills also follow the Peer prompt's rules: no HTML comments,
# and no mention of the orchestration layer.
function check_skill --argument-names label skill strict
    set -l file $skill/SKILL.md
    set -l name (path basename $skill)
    set -l front (awk 'NR == 1 && $0 != "---" { exit } NR > 1 && $0 == "---" { exit } NR > 1 { print }' $file)
    contains -- "name: $name" $front
    or fail "$label: skill $name has no frontmatter line 'name: $name'"
    set -l desc (string match -r --groups-only '^description: *"?(.*?)"?$' -- $front)
    if test -z "$desc"
        fail "$label: skill $name has no description, so Pi won't load it"
    else if test (string length -- $desc) -gt 1024
        fail "$label: skill $name has a description over 1,024 characters"
    end
    grep -qE '\$ARGUMENTS|\$\{CLAUDE_SKILL_DIR\}' $file
    and fail "$label: skill $name uses \$ARGUMENTS or \${CLAUDE_SKILL_DIR}, which Pi leaves as text"
    test (wc -l <$file) -ge 500
    and echo "  · $label: skill $name has 500+ lines; move detail into references/."
    if test "$strict" = peer
        grep -rq '<!--' $skill
        and fail "$label: skill $name contains an HTML comment, which Pi shows to the Peer"
        grep -rqiwE 'paseo|supervisor|seats?' $skill
        and fail "$label: skill $name mentions the orchestration layer, which the Peer doesn't know"
    end
end

# Print "name=path" for every skill a seat gets: each skill directory in <kit_dir>, then the
# extras (arguments after kit_dir) found in the plugin or $local_skills.
function seat_skill_entries --argument-names label kit_dir
    for skill in $kit_dir/*/
        set skill (path resolve $skill)
        test -f $skill/SKILL.md; and echo (path basename $skill)=$skill
    end
    for name in $argv[3..-1]
        set -l hit (string match -- "$name=*" $all_skills)
        if test -n "$hit"
            echo $hit[1]
        else
            fail "$label: extra skill '$name' is in neither the plugin nor $local_skills" >&2
        end
    end
end

# Link exactly the given skills ("name=path" arguments after `dry`) into <dir>/skills and
# remove everything else. Sets linked_count for the summary line.
function link_skills --argument-names label dir dry
    set -l linked
    for entry in $argv[4..-1]
        set -l parts (string split -m1 '=' $entry)
        set -l link $dir/skills/$parts[1]
        test $dry -eq 0; and ln -sfn $parts[2] $link
        set -a linked $parts[1]
        if not test -L $link; or not test -e $link
            fail "$label: skill '$parts[1]' is missing or has a broken link"
        else if test (readlink $link) != $parts[2]
            fail "$label: skill '$parts[1]' links to "(readlink $link)" (expected $parts[2])"
        end
    end
    for name in (command ls -1 $dir/skills 2>/dev/null)
        contains -- $name $linked; and test -e $dir/skills/$name; and continue
        if test $dry -eq 1
            fail "$label: leftover or dangling skill: $name"
        else
            rm -f $dir/skills/$name
        end
    end
    set -g linked_count (count $linked)
end

# Apply a jq filter (plus any jq options after it) to the Paseo config, keeping a backup. The
# file and the backup hold tokens, so both stay at mode 600.
function paseo_write --argument-names config label filter
    set -l jq_args $argv[4..-1]
    cp $config $config.bak
    chmod 600 $config.bak
    if jq $jq_args $filter $config >$config.new
        chmod 600 $config.new
        mv $config.new $config
        echo "  ~ $label (backup: $config.bak)"
    else
        rm -f $config.new
        fail "could not update $config ($label)"
    end
end

# ── Preconditions ────────────────────────────────────────────────────────────────────

# `path resolve` doesn't require the path to exist, so a copied script would still derive
# $repo and point real profiles at nothing. Stop here instead.
set -l required pi/PEER.md pi/settings.json pi/extensions/peer-guard.ts
for seat in $claude_seats
    set -a required claude/(string upper $seat).md
end
for file in $required
    if not test -f $repo/$file
        echo "! $repo/$file not found. Run the script from its original location in the repository."
        exit 1
    end
end
command -q jq; or begin
    echo "! jq must be on PATH."
    exit 1
end

set -g dry 0
for a in $argv
    switch $a
        case --check
            set dry 1
        case '*'
            # A mistyped flag would otherwise run in write mode, so don't guess.
            echo "! unknown argument: $a (usage: setup-seats.fish [--check])"
            exit 2
    end
end
test $dry -eq 1; and echo "[--check] verifying only; nothing will be written."

# projects/ is shared with the Human, and every Claude seat deletes old transcripts there on
# startup using its own cleanupPeriodDays. A seat that keeps fewer days than the Human deletes
# the Human's history, irreversibly. So seats inherit the Human's value; if the Human sets
# none, seats set none, and both use Claude Code's default.
set -l retention ""
if test -f $shared_claude/settings.json
    set retention (jq -r '.cleanupPeriodDays // empty' $shared_claude/settings.json 2>/dev/null)
    or begin
        echo "! $shared_claude/settings.json is not valid JSON, so cleanupPeriodDays is unknown."
        exit 1
    end
end

# ── Skill discovery: plugin first, then the local directory ─────────────────────────
# A local skill never replaces a plugin skill with the same name.

set -g all_skills   # each element is "name=path"
set -l plugin_root (jq -r --arg id $plugin_id '.plugins[$id][0].installPath // empty' \
    $shared_claude/plugins/installed_plugins.json 2>/dev/null)
if test -n "$plugin_root"; and test -d $plugin_root
    for rel in (jq -r '.skills[]?' $plugin_root/.claude-plugin/plugin.json 2>/dev/null)
        set -l abs $plugin_root/(string replace -r '^\./' '' -- $rel)
        test -f $abs/SKILL.md; and set -a all_skills (basename $abs)=$abs
    end
end
if test -d $local_skills
    for name in (command ls -1 $local_skills)
        test -f $local_skills/$name/SKILL.md; or continue
        contains -- $name (string replace -r '=.*' '' -- $all_skills)
        or set -a all_skills $name=$local_skills/$name
    end
end

# ── Claude seats ────────────────────────────────────────────────────────────────────

for seat in $claude_seats
    set -l err0 $errs
    set -l role (string upper $seat)
    set -l dir $profiles_root/claude-$seat
    set -l out $repo/claude/$seat.settings.json

    set -l var overlay_$seat
    set -l overlay $$var
    set var {$seat}_extra_skills
    set -l extras $$var

    # 1. Settings. Writing through a temp file compared with `cmp` keeps the run idempotent:
    #    $out changes only when its content would.
    set -l tmp (mktemp)
    if not jq --indent 2 --argjson ov "$overlay" --arg days "$retention" \
            '(. * $ov) | with_entries(select(.value != null))
             | if $days == "" then del(.cleanupPeriodDays)
               else .cleanupPeriodDays = ($days | tonumber) end' $base >$tmp
        rm -f $tmp
        fail "$seat: could not generate settings from $base"
        continue
    end
    if cmp -s $tmp $out
        rm -f $tmp
    else if test $dry -eq 1
        rm -f $tmp
        fail "$seat.settings.json is missing or differs from base + overlay (rerun without --check)"
    else
        mv $tmp $out
        echo "  ~ $seat.settings.json: regenerated from base + overlay"
    end

    # 2. Prompt budget.
    check_budget $repo/claude/$role.md

    # 3. Profile skeleton.
    if test $dry -eq 0
        mkdir -p $dir/skills
    end
    if not test -d $dir/skills
        fail "$seat: $dir/skills is missing"
        continue
    end
    seat_link $dir/CLAUDE.md     $repo/claude/$role.md    $dry
    seat_link $dir/settings.json $out                     $dry
    seat_link $dir/projects      $shared_claude/projects  $dry
    seat_link $dir/plugins       $shared_claude/plugins   $dry

    # Seats authenticate through the provider's env, so a leftover file here is credentials
    # sitting where they don't belong.
    test -e $dir/.credentials.json
    and fail "$seat: $dir/.credentials.json exists; delete it."

    # 4. .claude.json: skip onboarding and keep mcpServers empty. A target repository's MCP
    #    servers are external processes that start before the model's first turn, so a seat
    #    shouldn't pick any up.
    if test $dry -eq 0
        test -e $dir/.claude.json; or echo '{"hasCompletedOnboarding": true}' >$dir/.claude.json
        jq '.mcpServers = {} | .enabledMcpjsonServers = [] | del(.enableAllProjectMcpServers)
            | .projects = ((.projects // {}) | with_entries(.value.mcpServers = {}))' \
            $dir/.claude.json >$dir/.claude.json.new
        and mv $dir/.claude.json.new $dir/.claude.json
        or begin
            rm -f $dir/.claude.json.new
            fail "$seat: $dir/.claude.json is not valid JSON, so mcpServers was not cleared."
        end
    else
        jq -e '(.mcpServers // {}) == {} and ((.enabledMcpjsonServers // []) | length) == 0' \
            $dir/.claude.json >/dev/null 2>&1
        or fail "$seat: $dir/.claude.json is missing, broken, or has non-empty mcpServers."
    end

    # 5. Skills: the role's kit skills plus extras.
    for skill in $repo/skills/$seat/*/
        check_skill claude-$seat (path resolve $skill) claude
    end
    link_skills claude-$seat $dir $dry (seat_skill_entries claude-$seat $repo/skills/$seat $extras)

    test $errs -eq $err0
    and echo "✓ claude-$seat → $dir ($linked_count skills)"
    or echo "✗ claude-$seat → $dir (see the ! lines above)"
end

# ── Pi seat ─────────────────────────────────────────────────────────────────────────

set -l err0 $errs
set -g linked_count 0

# Pi loads APPEND_SYSTEM.md verbatim. Unlike Claude Code it doesn't strip HTML comments, so a
# maintainer note in PEER.md would reach the Peer.
grep -q '<!--' $repo/pi/PEER.md
and fail "pi/PEER.md contains an HTML comment, which Pi shows to the Peer. Move the note elsewhere."
check_budget $repo/pi/PEER.md

if test $dry -eq 0
    mkdir -p $pi_dir/skills $pi_dir/extensions
end
if not test -d $pi_dir/skills; or not test -d $pi_dir/extensions
    fail "pi-peer: $pi_dir is missing or incomplete"
else
    seat_link $pi_dir/APPEND_SYSTEM.md          $repo/pi/PEER.md                   $dry
    seat_link $pi_dir/extensions/peer-guard.ts  $repo/pi/extensions/peer-guard.ts  $dry

    # The Peer uses your normal Pi login. Pi rewrites auth.json in place, so token refreshes
    # go through the link to the shared file.
    if not test -f $pi_login
        fail "pi-peer: $pi_login not found; log in with `pi` (/login) or save an API key first."
    else
        seat_link $pi_dir/auth.json $pi_login $dry
    end

    # settings.json: Pi writes its own keys to this file, so merge the kit's keys in rather than
    # linking or replacing it.
    set -l settings $pi_dir/settings.json
    if not test -f $settings; or not jq -e --slurpfile kit $pi_settings \
            '. as $s | $kit[0] | to_entries | all(.[]; $s[.key] == .value)' $settings >/dev/null 2>&1
        if test $dry -eq 1
            fail "pi-peer: $settings is missing or lacks the keys in pi/settings.json (rerun without --check)"
        else
            set -l tmp (mktemp)
            if test -f $settings
                jq -s --indent 2 '.[0] * .[1]' $settings $pi_settings >$tmp
            else
                jq --indent 2 . $pi_settings >$tmp
            end
            and mv $tmp $settings
            and echo "  ~ pi-peer settings.json: merged pi/settings.json"
            or begin
                rm -f $tmp
                fail "pi-peer: could not write $settings"
            end
        end
    end

    # Paseo carries the profile's mcp.json into the Peer's launch; a paseo server there would
    # hand the Peer the orchestration tools that paseoTools switches off.
    if test -f $pi_dir/mcp.json
        jq -e '((.mcpServers // {}) | has("paseo")) | not' $pi_dir/mcp.json >/dev/null 2>&1
        or fail "pi-peer: $pi_dir/mcp.json defines a paseo server; remove it."
    end

    for skill in $repo/skills/peer/*/
        check_skill pi-peer (path resolve $skill) peer
    end
    link_skills pi-peer $pi_dir $dry (seat_skill_entries pi-peer $repo/skills/peer $peer_extra_skills)
end

# Pi also loads ~/.agents/skills, which sits outside the profile; see REFERENCE.md.
set -l leaked (count $local_skills/*/SKILL.md)
test $leaked -gt 0
and echo "  · Pi also gives the Peer the $leaked skill(s) in $local_skills."

test $errs -eq $err0
and echo "✓ pi-peer → $pi_dir ($linked_count skills)"
or echo "✗ pi-peer → $pi_dir (see the ! lines above)"

# ── Paseo providers ─────────────────────────────────────────────────────────────────
#
# A correct filesystem doesn't make a correct seat: if a provider doesn't point its profile
# variable at the directory just built, the seat reads a shared profile and carries none of
# this repository's prompts.

if not test -f $paseo_config
    echo "  · $paseo_config not found; skipping the provider step."
else if not jq -e . $paseo_config >/dev/null 2>&1
    fail "$paseo_config is not valid JSON; leaving it untouched."
else
    # The Lead and Supervisor create agents through Paseo's tools, which reach agents only when
    # the daemon injects them. This is daemon-wide, so the script reports it instead of fixing.
    jq -e '.daemon.mcp.injectIntoAgents == true' $paseo_config >/dev/null 2>&1
    or fail "daemon.mcp.injectIntoAgents is not true in $paseo_config, so the Lead and Supervisor get no Paseo tools."

    for seat in $claude_seats
        set -l key claude-$seat
        set -l want_dir (path resolve $profiles_root/$key)
        set -l var deny_$seat
        set -l deny_extra $$var

        if not jq -e --arg k $key '.agents.providers[$k]' $paseo_config >/dev/null 2>&1
            fail "$paseo_config has no provider `$key`; add it from examples/paseo-providers.json."
            continue
        end

        set -l have_dir (jq -r --arg k $key \
            '.agents.providers[$k].env.CLAUDE_CONFIG_DIR // ""' $paseo_config)
        if test -z "$have_dir"
            fail "provider $key has no env.CLAUDE_CONFIG_DIR; set it to $want_dir."
            continue
        else if test (path resolve $have_dir) != $want_dir
            fail "provider $key points CLAUDE_CONFIG_DIR at $have_dir, not $want_dir."
            continue
        end

        # Deny lists are additive: the script adds the entries it manages and keeps yours.
        set -l want (printf '%s\n' $deny_common $deny_extra | jq -s -c 'add | unique')
        set -l have (jq -c --arg k $key \
            '(.agents.providers[$k].disallowedTools // []) | unique' $paseo_config)
        set -l lack (echo $have | jq -c --argjson w "$want" '$w - .')
        test "$lack" = '[]'; and continue

        if test $dry -eq 1
            fail "provider $key lacks deny entries "(echo $lack | jq -r 'join(", ")')" (rerun without --check)"
            continue
        end
        set -l merged (echo $have | jq -c --argjson w "$want" '($w + .) | unique')
        paseo_write $paseo_config "provider $key: disallowedTools updated" \
            '.agents.providers[$k].disallowedTools = $d' --arg k $key --argjson d "$merged"
    end

    if not jq -e '.agents.providers["pi-peer"]' $paseo_config >/dev/null 2>&1
        fail "$paseo_config has no provider `pi-peer`; add it from examples/paseo-providers.json."
    else
        set -l have_dir (jq -r '.agents.providers["pi-peer"].env.PI_CODING_AGENT_DIR // ""' $paseo_config)
        if test -z "$have_dir"
            fail "provider pi-peer has no env.PI_CODING_AGENT_DIR; set it to $pi_dir."
        else
            # Pi expands a leading ~ itself, so compare the expanded path.
            set have_dir (string replace -r -- '^~' $HOME $have_dir)
            test (path resolve $have_dir) = (path resolve $pi_dir)
            or fail "provider pi-peer points PI_CODING_AGENT_DIR at $have_dir, not $pi_dir."
        end

        if not jq -e '.agents.providers["pi-peer"].paseoTools.enabled == false' $paseo_config >/dev/null 2>&1
            if test $dry -eq 1
                fail "provider pi-peer gives the Peer Paseo tools (rerun without --check)"
            else
                paseo_write $paseo_config "provider pi-peer: paseoTools disabled" \
                    '.agents.providers["pi-peer"].paseoTools = ((.agents.providers["pi-peer"].paseoTools // {}) + {enabled: false})'
            end
        end
    end
end

# ── Summary ─────────────────────────────────────────────────────────────────────────

echo ""
echo "After changing providers in $paseo_config, run `paseo reload`; there is no file watcher."
echo "Running agents keep their old prompt and guards until they end: archive them and delete"
echo "their schedules and heartbeats. New seats pick up prompts, settings, and skills."

if test $errs -ne 0
    echo ""
    echo "! $errs error(s) above; the seats are not in the intended state."
    exit 1
end
