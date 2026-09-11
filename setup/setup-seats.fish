#!/usr/bin/env fish
#
# setup-seats: build or refresh a Claude Code profile for each seat (lead, peer, supervisor).
#
# Seat prompts and settings live in this repository (claude/<ROLE>.md,
# setup/seat-settings.base.json). The script symlinks them into
# ~/.claude/profiles/claude-<seat>/, the directory each Paseo provider points
# CLAUDE_CONFIG_DIR at, so an edit here reaches the next seat spawned without copying.
#
# For each seat, the script:
#   1. Generates claude/<seat>.settings.json from the base settings plus the seat's overlay.
#   2. Builds ~/.claude/profiles/claude-<seat>/: CLAUDE.md, settings.json, projects, plugins,
#      and skills/ (allowlisted skills only).
#   3. Adds the seat's deny list to the `disallowedTools` of provider claude-<seat> in
#      ~/.paseo/config.json.
#
# Usage:
#   fish setup/setup-seats.fish            # build or update
#   fish setup/setup-seats.fish --check    # verify only; write nothing
#
# Requires fish 3.5+ (for the `path` builtin) and jq. The script never touches credentials:
# each seat's token lives in its provider's `env` in ~/.paseo/config.json and is set by hand.
# Rerun after `claude plugin update`: plugin skill paths contain the version number, so an
# update silently breaks the symlinks.

# ── Configuration ────────────────────────────────────────────────────────────────────

set -l repo (path resolve (path dirname (status filename))/..)
set -l seats $repo/claude
set -l base  $repo/setup/seat-settings.base.json

# To add a seat, add its name here and provide claude/<ROLE>.md, <seat>_skills,
# deny_<seat>, overlay_<seat>, and a claude-<seat> provider in ~/.paseo/config.json.
set -l seat_names lead peer supervisor

set -l profiles_root $HOME/.claude/profiles       # one CLAUDE_CONFIG_DIR per seat
set -l shared_claude $HOME/.claude                # projects/ and plugins/ are shared
set -l local_skills  $HOME/.agents/skills         # your own skills
set -l plugin_id     mattpocock-skills@mattpocock # optional second skill source
set -l paseo_config  $HOME/.paseo/config.json

# Byte budget per seat prompt. Exceeding it is an error: cut content instead of raising it.
set -l prompt_budget 16384

# Skills each seat can see, named by the directory that holds SKILL.md. The script looks in
# the $plugin_id plugin first, then in $local_skills. An empty list means no skills.
set -l lead_skills       # for example: domain-modeling codebase-design
set -l peer_skills
set -l supervisor_skills

# Tools blocked at the provider level, which is where blocking actually happens. A seat's
# `permissions.deny` only looks safe, so the base settings leave it out.
# `Bash(git push:*)` matches by prefix: it is a guard rail, not a sandbox, because
# `git -C repo push` gets through.
set -l deny_common '["Agent", "Task", "SlashCommand", "Workflow", "WebSearch",
                     "TodoWrite", "EnterPlanMode", "ExitPlanMode",
                     "Bash(claude:*)", "Bash(npx claude:*)", "Bash(git push:*)"]'
set -l deny_lead       '["LSP"]'
set -l deny_peer       '["mcp__paseo", "Bash(paseo:*)", "AskUserQuestion"]'
set -l deny_supervisor '["LSP"]'

# Per-seat differences from the base settings. `null` removes the key.
set -l overlay_lead '{
  "outputStyle": "Concise",
  "disableBundledSkills": true,
  "askUserQuestionTimeout": "never",
  "promptCacheTtl": "1h"
}'
set -l overlay_peer '{
  "outputStyle": "Concise",
  "disableBundledSkills": true,
  "askUserQuestionTimeout": null
}'
set -l overlay_supervisor '{
  "outputStyle": "Concise",
  "disableBundledSkills": true,
  "askUserQuestionTimeout": "never"
}'

# ── Helpers ──────────────────────────────────────────────────────────────────────────

set -g errs 0

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

# ── Preconditions ────────────────────────────────────────────────────────────────────

# `path resolve` doesn't require the path to exist, so a copied script would still derive
# $repo and point real profiles at nothing. Stop here instead.
for seat in $seat_names
    set -l prompt $seats/(string upper $seat).md
    if not test -f $prompt
        echo "! $prompt not found. Run the script from its original location in the repository."
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

# projects/ is shared with the Human, and every seat deletes old transcripts there on startup
# using its own cleanupPeriodDays. A seat that keeps fewer days than the Human deletes the
# Human's history, irreversibly. So seats inherit the Human's value; if the Human sets none,
# seats set none, and both use Claude Code's default.
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

set -l skills   # each element is "name=path"
set -l plugin_root (jq -r --arg id $plugin_id '.plugins[$id][0].installPath // empty' \
    $shared_claude/plugins/installed_plugins.json 2>/dev/null)
if test -n "$plugin_root"; and test -d $plugin_root
    for rel in (jq -r '.skills[]?' $plugin_root/.claude-plugin/plugin.json 2>/dev/null)
        set -l abs $plugin_root/(string replace -r '^\./' '' -- $rel)
        test -f $abs/SKILL.md; and set -a skills (basename $abs)=$abs
    end
end
if test -d $local_skills
    for name in (command ls -1 $local_skills)
        test -f $local_skills/$name/SKILL.md; or continue
        contains -- $name (string replace -r '=.*' '' -- $skills)
        or set -a skills $name=$local_skills/$name
    end
end

# ── Main loop: one profile per seat ─────────────────────────────────────────────────

for seat in $seat_names
    set -l err0 $errs
    set -l role (string upper $seat)
    set -l dir $profiles_root/claude-$seat
    set -l out $seats/$seat.settings.json

    set -l var overlay_$seat
    set -l overlay $$var
    set var {$seat}_skills
    set -l keep $$var

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
    set -l size (wc -c <$seats/$role.md | string trim)
    set -l pct (math "round($size * 100 / $prompt_budget)")
    if test $size -gt $prompt_budget
        fail "$role.md is $size bytes, $pct% of the $prompt_budget-byte budget. Cut it."
    else if test $pct -ge 85
        echo "  · $role.md is $size bytes, $pct% of the $prompt_budget-byte budget; nearly full."
    end

    # 3. Profile skeleton.
    if test $dry -eq 0
        mkdir -p $dir/skills
    end
    if not test -d $dir/skills
        fail "$seat: $dir/skills is missing"
        continue
    end
    seat_link $dir/CLAUDE.md     $seats/$role.md          $dry
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

    # 5. Skills: link exactly the allowlist and remove everything else.
    set -l linked
    for entry in $skills
        set -l parts (string split -m1 '=' $entry)
        contains -- $parts[1] $keep; or continue
        test $dry -eq 0; and ln -sfn $parts[2] $dir/skills/$parts[1]
        set -a linked $parts[1]
        test -L $dir/skills/$parts[1]; and test -e $dir/skills/$parts[1]
        or fail "$seat: skill '$parts[1]' has a broken link"
    end
    for name in $keep
        contains -- $name $linked
        or fail "$seat: allowlisted skill '$name' is in neither the plugin nor $local_skills"
    end
    for name in (command ls -1 $dir/skills 2>/dev/null)
        contains -- $name $linked; and test -e $dir/skills/$name; and continue
        if test $dry -eq 1
            fail "$seat: leftover or dangling skill: $name"
        else
            rm -f $dir/skills/$name
        end
    end

    test $errs -eq $err0
    and echo "✓ claude-$seat → $dir ("(count $linked)" skills)"
    or echo "✗ claude-$seat → $dir (see the ! lines above)"
end

# ── Paseo providers ─────────────────────────────────────────────────────────────────
#
# A correct filesystem doesn't make a correct seat: if the provider doesn't point
# CLAUDE_CONFIG_DIR at the profile just built, the seat reads the shared ~/.claude and
# carries none of this repository's prompts.

if not test -f $paseo_config
    echo "  · $paseo_config not found; skipping the provider step."
else if not jq -e . $paseo_config >/dev/null 2>&1
    fail "$paseo_config is not valid JSON; leaving it untouched."
else
    for seat in $seat_names
        set -l key claude-$seat
        set -l want_dir (path resolve $profiles_root/$key)
        set -l var deny_$seat
        set -l deny_extra $$var

        if not jq -e --arg k $key '.agents.providers[$k]' $paseo_config >/dev/null 2>&1
            fail "$paseo_config has no provider `$key`; create it by hand (extends/env/models)."
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
        # The backup holds the token too, so restrict it like the original.
        cp $paseo_config $paseo_config.bak
        chmod 600 $paseo_config.bak
        if jq --arg k $key --argjson d "$merged" \
                '.agents.providers[$k].disallowedTools = $d' $paseo_config >$paseo_config.new
            chmod 600 $paseo_config.new
            mv $paseo_config.new $paseo_config
            echo "  ~ provider $key: disallowedTools updated (backup: $paseo_config.bak)"
        else
            rm -f $paseo_config.new
            fail "could not write disallowedTools to $paseo_config"
        end
    end
end

# ── Summary ─────────────────────────────────────────────────────────────────────────

echo ""
echo "After changing providers in $paseo_config, run `paseo reload`; there is no file watcher."
echo "Running agents keep their old prompt and deny list until they end: archive them and"
echo "delete their schedules and heartbeats. New seats pick up prompts, settings, and skills."

if test $errs -ne 0
    echo ""
    echo "! $errs error(s) above; the seats are not in the intended state."
    exit 1
end
