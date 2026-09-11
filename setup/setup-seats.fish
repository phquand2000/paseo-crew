#!/usr/bin/env fish
#
# setup-seats: build or refresh every seat's profile.
#
# Each project has three seats: claude-supervisor-SLUG and claude-lead-SLUG (Claude Code), and
# pi-peer-SLUG (Pi). Profiles, settings, deny lists, and models are global; every .md a seat
# loads lives in that project's .seatworks/ directory, and the profile links to it, so an edit
# reaches the next seat spawned without copying. Projects are the providers named
# claude-lead-SLUG in ~/.paseo/config.json, whose env.SEATWORKS_REPO names the repository;
# setup/add-project.fish creates them.
#
# Usage:
#   fish setup/setup-seats.fish            # build or update
#   fish setup/setup-seats.fish --check    # verify only; write nothing
#
# Requires fish 3.5+ (for the `path` builtin) and jq. The script never reads credentials:
# Claude seats inherit the token from the base `claude` provider, and Peer seats link to the
# auth.json of your normal Pi profile.
# Rerun after `claude plugin update`: plugin skill paths contain the version number, so an
# update silently breaks the symlinks.

# ── Configuration ────────────────────────────────────────────────────────────────────

set -g kit (path resolve (path dirname (status filename))/..)
set -l base $kit/setup/seat-settings.base.json

set -g profiles_root    $HOME/.claude/profiles      # one CLAUDE_CONFIG_DIR per Claude seat
set -g pi_profiles_root $HOME/.pi/profiles          # one PI_CODING_AGENT_DIR per Peer seat
set -g shared_claude    $HOME/.claude               # projects/ and plugins/ are shared
set -g pi_login         $HOME/.pi/agent/auth.json   # your normal Pi login, shared with Peers
set -g pi_settings      $kit/pi/settings.json
set -g peer_guard       $kit/pi/extensions/peer-guard.ts
set -g local_skills     $HOME/.agents/skills        # your own skills
set -l plugin_id        mattpocock-skills@mattpocock
set -g paseo_config     $HOME/.paseo/config.json

# Byte budget per seat prompt. Exceeding it is an error: cut content instead of raising it.
set -g prompt_budget 16384

# Extra skills, from Paseo's package, the $plugin_id plugin, or $local_skills, on top of each
# seat's own skills directory. Name them by the directory that holds SKILL.md. `paseo` is
# Paseo's reference for workspaces, scripts, profiles, schedules, and waiting.
set -g supervisor_extra_skills paseo
set -g lead_extra_skills       paseo    # add others, for example: domain-modeling
set -g peer_extra_skills

# Claude tools blocked at the provider level, which is where blocking happens for Claude
# seats; a seat's `permissions.deny` only looks safe, so the base settings leave it out.
# `Bash(git push:*)` matches by prefix, so `git -C repo push` gets through. `gh` is blocked
# because pushes, pull requests, and API calls through it leave the machine, which is the
# Human's call. Pi ignores disallowedTools; pi/extensions/peer-guard.ts guards the Peer instead.
set -g deny_common '["Agent", "Task", "SlashCommand", "Workflow", "WebSearch",
                     "TodoWrite", "EnterPlanMode", "ExitPlanMode",
                     "Bash(claude:*)", "Bash(npx claude:*)", "Bash(git push:*)", "Bash(gh:*)"]'
set -g deny_lead       '["LSP"]'
set -g deny_supervisor '["LSP"]'

# Per-role differences from the base settings. `null` removes the key. Every Lead shares one
# generated settings file, and so does every Supervisor.
set -l overlay_lead '{
  "outputStyle": "Concise",
  "disableBundledSkills": true,
  "askUserQuestionTimeout": "never",
  "promptCacheTtl": "1h"
}'
# Only the Supervisor keeps Claude Code's auto memory, as in the practitioner's Codex setup:
# it is the project's organizational memory, while Leads and Peers start clean.
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
    if test $size -gt $prompt_budget
        fail "$file is $size bytes, $pct% of the $prompt_budget-byte budget. Cut it."
    else if test $pct -ge 85
        echo "  · $file is $size bytes, $pct% of the $prompt_budget-byte budget; nearly full."
    end
end

# Check that a skill works in both runtimes: the frontmatter name matches the directory
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

# Print "name=path" for every skill a seat gets: each skill directory in <skills_dir>, then the
# extras (arguments after skills_dir) found in the plugin or $local_skills.
function seat_skill_entries --argument-names label skills_dir
    for skill in $skills_dir/*/
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

# Build one Claude seat's profile: CLAUDE.md, settings.json, the shared projects/ and plugins/,
# an .claude.json without MCP servers, and skills from <skills_dir> plus extras.
function build_claude_seat --argument-names label dir prompt settings skills_dir
    set -l extras $argv[6..-1]
    set -l err0 $errs
    set -g linked_count 0
    if not test -f $prompt
        fail "$label: $prompt not found"
    else
        check_budget $prompt
        test $dry -eq 0; and mkdir -p $dir/skills
        if not test -d $dir/skills
            fail "$label: $dir/skills is missing"
        else
            seat_link $dir/CLAUDE.md     $prompt                  $dry
            seat_link $dir/settings.json $settings                $dry
            seat_link $dir/projects      $shared_claude/projects  $dry
            seat_link $dir/plugins       $shared_claude/plugins   $dry

            # Seats authenticate through the provider's env, so a leftover file here is
            # credentials sitting where they don't belong.
            test -e $dir/.credentials.json
            and fail "$label: $dir/.credentials.json exists; delete it."

            # .claude.json: skip onboarding and keep mcpServers empty. A target repository's MCP
            # servers are external processes that start before the model's first turn, so a
            # seat shouldn't pick any up.
            if test $dry -eq 0
                test -e $dir/.claude.json; or echo '{"hasCompletedOnboarding": true}' >$dir/.claude.json
                jq '.mcpServers = {} | .enabledMcpjsonServers = [] | del(.enableAllProjectMcpServers)
                    | .projects = ((.projects // {}) | with_entries(.value.mcpServers = {}))' \
                    $dir/.claude.json >$dir/.claude.json.new
                and mv $dir/.claude.json.new $dir/.claude.json
                or begin
                    rm -f $dir/.claude.json.new
                    fail "$label: $dir/.claude.json is not valid JSON, so mcpServers was not cleared."
                end
            else
                jq -e '(.mcpServers // {}) == {} and ((.enabledMcpjsonServers // []) | length) == 0' \
                    $dir/.claude.json >/dev/null 2>&1
                or fail "$label: $dir/.claude.json is missing, broken, or has non-empty mcpServers."
            end

            for skill in $skills_dir/*/
                check_skill $label (path resolve $skill) claude
            end
            link_skills $label $dir $dry (seat_skill_entries $label $skills_dir $extras)
        end
    end
    test $errs -eq $err0
    and echo "✓ $label → $dir ($linked_count skills)"
    or echo "✗ $label → $dir (see the ! lines above)"
end

# Build one Peer seat's Pi profile: APPEND_SYSTEM.md, the guard extension, a link to your Pi
# login, settings.json with the kit's keys merged in, and skills from <skills_dir> plus extras.
function build_peer_seat --argument-names label dir prompt skills_dir
    set -l extras $argv[5..-1]
    set -l err0 $errs
    set -g linked_count 0
    if not test -f $prompt
        fail "$label: $prompt not found"
    else
        # Pi loads APPEND_SYSTEM.md verbatim. Unlike Claude Code it doesn't strip HTML comments,
        # so a maintainer note in PEER.md would reach the Peer.
        grep -q '<!--' $prompt
        and fail "$label: $prompt contains an HTML comment, which Pi shows to the Peer."
        check_budget $prompt
        test $dry -eq 0; and mkdir -p $dir/skills $dir/extensions
        if not test -d $dir/skills; or not test -d $dir/extensions
            fail "$label: $dir is missing or incomplete"
        else
            seat_link $dir/APPEND_SYSTEM.md          $prompt     $dry
            seat_link $dir/extensions/peer-guard.ts  $peer_guard $dry

            # The Peer uses your normal Pi login. Pi rewrites auth.json in place, so token
            # refreshes go through the link to the shared file.
            if not test -f $pi_login
                fail "$label: $pi_login not found; log in with `pi` (/login) or save an API key first."
            else
                seat_link $dir/auth.json $pi_login $dry
            end

            # settings.json: Pi writes its own keys to this file, so merge the kit's keys in
            # rather than linking or replacing it.
            set -l settings $dir/settings.json
            if not test -f $settings; or not jq -e --slurpfile kit_keys $pi_settings \
                    '. as $s | $kit_keys[0] | to_entries | all(.[]; $s[.key] == .value)' $settings >/dev/null 2>&1
                if test $dry -eq 1
                    fail "$label: $settings is missing or lacks the keys in pi/settings.json (rerun without --check)"
                else
                    set -l tmp (mktemp)
                    if test -f $settings
                        jq -s --indent 2 '.[0] * .[1]' $settings $pi_settings >$tmp
                    else
                        jq --indent 2 . $pi_settings >$tmp
                    end
                    and mv $tmp $settings
                    and echo "  ~ $label settings.json: merged pi/settings.json"
                    or begin
                        rm -f $tmp
                        fail "$label: could not write $settings"
                    end
                end
            end

            # Paseo carries the profile's mcp.json into the Peer's launch; a paseo server there
            # would hand the Peer the orchestration tools that paseoTools switches off.
            if test -f $dir/mcp.json
                jq -e '((.mcpServers // {}) | has("paseo")) | not' $dir/mcp.json >/dev/null 2>&1
                or fail "$label: $dir/mcp.json defines a paseo server; remove it."
            end

            for skill in $skills_dir/*/
                check_skill $label (path resolve $skill) peer
            end
            link_skills $label $dir $dry (seat_skill_entries $label $skills_dir $extras)
        end
    end
    test $errs -eq $err0
    and echo "✓ $label → $dir ($linked_count skills)"
    or echo "✗ $label → $dir (see the ! lines above)"
end

# Check that a Claude seat's provider points CLAUDE_CONFIG_DIR at <dir>, and add the deny
# entries this script manages. Deny lists are additive: your own entries stay.
function claude_provider --argument-names key dir deny_extra
    if not jq -e --arg k $key '.agents.providers[$k]' $paseo_config >/dev/null 2>&1
        fail "$paseo_config has no provider `$key`."
        return
    end
    set -l have_dir (jq -r --arg k $key '.agents.providers[$k].env.CLAUDE_CONFIG_DIR // ""' $paseo_config)
    if test -z "$have_dir"
        fail "provider $key has no env.CLAUDE_CONFIG_DIR; set it to $dir."
        return
    else if test (path resolve $have_dir) != (path resolve $dir)
        fail "provider $key points CLAUDE_CONFIG_DIR at $have_dir, not $dir."
        return
    end
    set -l want (printf '%s\n' $deny_common $deny_extra | jq -s -c 'add | unique')
    set -l have (jq -c --arg k $key '(.agents.providers[$k].disallowedTools // []) | unique' $paseo_config)
    set -l lack (echo $have | jq -c --argjson w "$want" '$w - .')
    test "$lack" = '[]'; and return
    if test $dry -eq 1
        fail "provider $key lacks deny entries "(echo $lack | jq -r 'join(", ")')" (rerun without --check)"
        return
    end
    set -l merged (echo $have | jq -c --argjson w "$want" '($w + .) | unique')
    paseo_write $paseo_config "provider $key: disallowedTools updated" \
        '.agents.providers[$k].disallowedTools = $d' --arg k $key --argjson d "$merged"
end

# Check that a Peer seat's provider points PI_CODING_AGENT_DIR at <dir>, and switch its Paseo
# tools off. Pi ignores disallowedTools, so paseoTools and the guard extension are its limits.
function peer_provider --argument-names key dir
    if not jq -e --arg k $key '.agents.providers[$k]' $paseo_config >/dev/null 2>&1
        fail "$paseo_config has no provider `$key`."
        return
    end
    set -l have_dir (jq -r --arg k $key '.agents.providers[$k].env.PI_CODING_AGENT_DIR // ""' $paseo_config)
    if test -z "$have_dir"
        fail "provider $key has no env.PI_CODING_AGENT_DIR; set it to $dir."
    else
        # Pi expands a leading ~ itself, so compare the expanded path.
        set have_dir (string replace -r -- '^~' $HOME $have_dir)
        test (path resolve $have_dir) = (path resolve $dir)
        or fail "provider $key points PI_CODING_AGENT_DIR at $have_dir, not $dir."
    end
    if not jq -e --arg k $key '.agents.providers[$k].paseoTools.enabled == false' $paseo_config >/dev/null 2>&1
        if test $dry -eq 1
            fail "provider $key gives the Peer Paseo tools (rerun without --check)"
        else
            paseo_write $paseo_config "provider $key: paseoTools disabled" \
                '.agents.providers[$k].paseoTools = ((.agents.providers[$k].paseoTools // {}) + {enabled: false})' --arg k $key
        end
    end
end

# ── Preconditions ────────────────────────────────────────────────────────────────────

# `path resolve` doesn't require the path to exist, so a copied script would still derive
# $kit and point real profiles at nothing. Stop here instead.
for file in setup/seat-settings.base.json pi/settings.json pi/extensions/peer-guard.ts
    if not test -f $kit/$file
        echo "! $kit/$file not found. Run the script from its original location in the kit."
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
# Only the extras above are taken from here. A local skill never replaces a plugin skill with
# the same name.

set -g all_skills   # each element is "name=path"

# Paseo's own skills ship inside its package. Paseo's app can install copies into
# ~/.claude/skills and ~/.agents/skills, but Claude seats read their own profiles, and Pi would
# hand the ~/.agents copies to the Peer. So they are linked from the package, which also keeps
# them current across Paseo updates.
set -l paseo_bin (command -v paseo)
if test -n "$paseo_bin"
    set -l paseo_skills (path resolve (path dirname (path resolve $paseo_bin))/../node_modules/@getpaseo/server/dist/server/skills)
    for skill in $paseo_skills/*/
        test -f $skill/SKILL.md; and set -a all_skills (path basename $skill)=(path resolve $skill)
    end
end
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

# ── Settings shared by each Claude role ─────────────────────────────────────────────
# Writing through a temp file compared with `cmp` keeps the run idempotent: a settings file
# changes only when its content would.

test $dry -eq 0; and mkdir -p $kit/claude
for role in lead supervisor
    set -l var overlay_$role
    set -l overlay $$var
    set -l out $kit/claude/$role.settings.json
    set -l tmp (mktemp)
    if not jq --indent 2 --argjson ov "$overlay" --arg days "$retention" \
            '(. * $ov) | with_entries(select(.value != null))
             | if $days == "" then del(.cleanupPeriodDays)
               else .cleanupPeriodDays = ($days | tonumber) end' $base >$tmp
        rm -f $tmp
        fail "$role: could not generate settings from $base"
        continue
    end
    if cmp -s $tmp $out
        rm -f $tmp
    else if test $dry -eq 1
        rm -f $tmp
        fail "$role.settings.json is missing or differs from base + overlay (rerun without --check)"
    else
        mv $tmp $out
        echo "  ~ $role.settings.json: regenerated from base + overlay"
    end
end

# ── Paseo config ────────────────────────────────────────────────────────────────────

set -l paseo_ok 0
if not test -f $paseo_config
    echo "  · $paseo_config not found; skipping the provider checks and the projects."
else if not jq -e . $paseo_config >/dev/null 2>&1
    fail "$paseo_config is not valid JSON; leaving it untouched."
else
    set paseo_ok 1
    # The Lead and Supervisor create agents through Paseo's tools, which reach agents only when
    # the daemon injects them. This is daemon-wide, so the script reports it instead of fixing.
    jq -e '.daemon.mcp.injectIntoAgents == true' $paseo_config >/dev/null 2>&1
    or fail "daemon.mcp.injectIntoAgents is not true in $paseo_config, so the Lead and Supervisor get no Paseo tools."
end

# ── Project seats ───────────────────────────────────────────────────────────────────
# A filesystem that looks right doesn't make a seat right: if its provider doesn't point at
# the profile built here, the seat reads a shared profile and carries none of its project's
# prompts. So each project's providers are checked together with its profiles.

set -l projects
test $paseo_ok -eq 1
and set projects (jq -r '.agents.providers | to_entries[] | select(.key | startswith("claude-lead-"))
    | "\(.key | ltrimstr("claude-lead-"))=\(.value.env.SEATWORKS_REPO // "")"' $paseo_config)
test (count $projects) -eq 0
and echo "  · no projects yet; add one with: fish setup/add-project.fish REPO_DIR"

for entry in $projects
    set -l parts (string split -m1 '=' $entry)
    set -l slug $parts[1]
    set -l repo_dir $parts[2]
    if test -z "$repo_dir"; or not test -d $repo_dir/.seatworks
        fail "project $slug: claude-lead-$slug has no env.SEATWORKS_REPO, or $repo_dir/.seatworks is missing; rerun setup/add-project.fish."
        continue
    end
    set -l seat $repo_dir/.seatworks
    build_claude_seat claude-supervisor-$slug $profiles_root/claude-supervisor-$slug $seat/SUPERVISOR.md \
        $kit/claude/supervisor.settings.json $seat/skills/supervisor $supervisor_extra_skills
    claude_provider claude-supervisor-$slug $profiles_root/claude-supervisor-$slug $deny_supervisor
    # The Supervisor reaches the kit's setup scripts and templates through SEATWORKS_KIT.
    test (jq -r --arg k claude-supervisor-$slug '.agents.providers[$k].env.SEATWORKS_KIT // ""' $paseo_config) = $kit
    or fail "provider claude-supervisor-$slug: env.SEATWORKS_KIT is not $kit; rerun setup/add-project.fish."
    build_claude_seat claude-lead-$slug $profiles_root/claude-lead-$slug $seat/LEAD.md \
        $kit/claude/lead.settings.json $seat/skills/lead $lead_extra_skills
    claude_provider claude-lead-$slug $profiles_root/claude-lead-$slug $deny_lead
    build_peer_seat pi-peer-$slug $pi_profiles_root/pi-peer-$slug $seat/PEER.md \
        $seat/skills/peer $peer_extra_skills
    peer_provider pi-peer-$slug $pi_profiles_root/pi-peer-$slug
end

# Pi also loads ~/.agents/skills, which sits outside every profile; see REFERENCE.md.
set -l leaked (count $local_skills/*/SKILL.md)
test $leaked -gt 0
and echo "  · Pi also gives every Peer the $leaked skill(s) in $local_skills."

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
