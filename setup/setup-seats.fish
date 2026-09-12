#!/usr/bin/env fish

set -g kit (path resolve (path dirname (status filename))/..)

set -g profiles_root    $HOME/.claude/profiles
set -g pi_profiles_root $HOME/.pi/profiles
set -g shared_claude    $HOME/.claude
set -g pi_login         $HOME/.pi/agent/auth.json
set -g pi_settings      $kit/pi/settings.json
set -g peer_guard       $kit/pi/extensions/peer-guard.ts
set -g local_skills     $HOME/.agents/skills
set -l plugin_id        mattpocock-skills@mattpocock
set -g paseo_config     $HOME/.paseo/config.json

set -g prompt_budget 16384

set -g supervisor_extra_skills paseo
set -g lead_extra_skills       paseo
set -g watcher_extra_skills    paseo
set -g peer_extra_skills
set -g reviewer_extra_skills   peer:proof-audit

set -g deny_common '["Agent", "Task", "SlashCommand", "Workflow", "WebSearch",
                     "TodoWrite", "EnterPlanMode", "ExitPlanMode",
                     "Bash(claude:*)", "Bash(npx claude:*)", "Bash(git push:*)", "Bash(gh:*)"]'
set -g deny_lead       '["LSP"]'
set -g deny_supervisor '["LSP"]'
set -g deny_watcher    '["LSP", "Edit", "Write", "MultiEdit", "NotebookEdit",
                         "mcp__paseo__create_agent", "mcp__paseo__update_agent", "mcp__paseo__archive_agent",
                         "mcp__paseo__set_agent_mode", "mcp__paseo__create_workspace",
                         "mcp__paseo__archive_workspace", "mcp__paseo__start_workspace_script",
                         "mcp__paseo__create_schedule", "mcp__paseo__update_schedule",
                         "mcp__paseo__delete_schedule", "mcp__paseo__respond_to_permission",
                         "mcp__paseo__kill_agent", "mcp__paseo__cancel_agent",
                         "mcp__paseo__pause_schedule", "mcp__paseo__resume_schedule",
                         "mcp__paseo__run_schedule_once", "mcp__paseo__rename_workspace",
                         "mcp__paseo__stop_workspace_script", "mcp__paseo__create_terminal",
                         "mcp__paseo__send_terminal_keys", "mcp__paseo__kill_terminal",
                         "mcp__paseo__speak"]'

set -g stamp (date +%Y%m%d-%H%M%S)
set -g errs 0
set -g linked_count 0

function fail
    echo "  ! $argv"
    set -g errs (math $errs + 1)
end

function seat_link --argument-names link want dry
    if test -d $link; and not test -L $link
        fail "$link is a real directory: delete it and rerun"
        return
    end
    test $dry -eq 0; and ln -sfn $want $link
    if not test -L $link
        fail "$link is not a symlink"
    else if test (readlink $link) != $want
        fail "$link -> "(readlink $link)" (expected $want)"
    else if not test -e $link
        fail "dangling symlink: $link -> "(readlink $link)
    end
end

function check_budget --argument-names file
    set -l size (wc -c <$file | string trim)
    set -l pct (math "round($size * 100 / $prompt_budget)")
    if test $size -gt $prompt_budget
        fail "$file is $size bytes, $pct% of the $prompt_budget-byte budget. Cut it."
    else if test $pct -ge 85
        echo "  · $file is $size bytes, $pct% of the $prompt_budget-byte budget; nearly full."
    end
end

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
        grep -rqiwE 'paseo|supervisor|watcher|seats?' $skill
        and fail "$label: skill $name mentions the orchestration layer, which the Peer doesn't know"
    end
end

function seat_skill_entries --argument-names label skills_dir
    for skill in $skills_dir/*/
        set skill (path resolve $skill)
        test -f $skill/SKILL.md; and echo (path basename $skill)=$skill
    end
    for name in $argv[3..-1]
        if string match -q 'peer:*' -- $name
            set -l shared (path resolve $skills_dir/../peer/(string replace 'peer:' '' -- $name))
            if test -f $shared/SKILL.md
                echo (path basename $shared)=$shared
            else
                fail "$label: shared skill '$name' is not in "(path dirname $shared) >&2
            end
            continue
        end
        set -l hit (string match -- "$name=*" $all_skills)
        if test -n "$hit"
            echo $hit[1]
        else
            fail "$label: extra skill '$name' is not in Paseo's @getpaseo/server package, the plugin, or $local_skills" >&2
        end
    end
end

function link_skills --argument-names label dir dry
    set -l linked
    for entry in $argv[4..-1]
        set -l parts (string split -m1 '=' $entry)
        seat_link $dir/skills/$parts[1] $parts[2] $dry
        set -a linked $parts[1]
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

function paseo_write --argument-names config label filter
    set -l jq_args $argv[4..-1]
    set -l bak $config.bak.$stamp
    test -e $bak; or cp $config $bak
    chmod 600 $bak
    if jq $jq_args $filter $config >$config.new
        chmod 600 $config.new
        mv $config.new $config
        echo "  ~ $label (backup: $bak)"
    else
        rm -f $config.new
        fail "could not update $config ($label)"
    end
end

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

            test -e $dir/.credentials.json
            and fail "$label: $dir/.credentials.json exists; delete it."

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

function build_peer_seat --argument-names label dir prompt skills_dir
    set -l extras $argv[5..-1]
    set -l err0 $errs
    set -g linked_count 0
    if not test -f $prompt
        fail "$label: $prompt not found"
    else
        grep -q '<!--' $prompt
        and fail "$label: $prompt contains an HTML comment, which Pi shows to the Peer."
        grep -qiwE 'paseo|supervisor|watcher|seats?' $prompt
        and fail "$label: $prompt mentions the orchestration layer, which the Peer doesn't know."
        check_budget $prompt
        test $dry -eq 0; and mkdir -p $dir/skills $dir/extensions
        if not test -d $dir/skills; or not test -d $dir/extensions
            fail "$label: $dir is missing or incomplete"
        else
            seat_link $dir/APPEND_SYSTEM.md          $prompt     $dry
            seat_link $dir/extensions/peer-guard.ts  $peer_guard $dry

            if not test -f $pi_login
                fail "$label: $pi_login not found; log in with `pi` (/login) or save an API key first."
            else
                seat_link $dir/auth.json $pi_login $dry
            end

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

function peer_provider --argument-names key dir
    if not jq -e --arg k $key '.agents.providers[$k]' $paseo_config >/dev/null 2>&1
        fail "$paseo_config has no provider `$key`."
        return
    end
    set -l have_dir (jq -r --arg k $key '.agents.providers[$k].env.PI_CODING_AGENT_DIR // ""' $paseo_config)
    if test -z "$have_dir"
        fail "provider $key has no env.PI_CODING_AGENT_DIR; set it to $dir."
    else
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

function optional_seat --argument-names key repo_dir
    jq -e --arg k $key '.agents.providers[$k]' $paseo_config >/dev/null 2>&1
    and return 0
    echo "  · $key doesn't exist yet; add it with: fish $kit/setup/add-project.fish $repo_dir"
    return 1
end

function read_only_provider --argument-names key
    jq -e --arg k $key '.agents.providers[$k].env.SEATWORKS_READ_ONLY == "1"' $paseo_config >/dev/null 2>&1
    and return
    if test $dry -eq 1
        fail "provider $key lacks env.SEATWORKS_READ_ONLY=1, so the seat could edit files (rerun without --check)"
    else
        paseo_write $paseo_config "provider $key: env.SEATWORKS_READ_ONLY set" \
            '.agents.providers[$k].env.SEATWORKS_READ_ONLY = "1"' --arg k $key
    end
end

for file in claude/lead.settings.json claude/supervisor.settings.json claude/watcher.settings.json \
        claude/lead-guard.sh claude/profile-guard.sh claude/watcher-guard.sh pi/settings.json pi/extensions/peer-guard.ts
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
            echo "! unknown argument: $a (usage: setup-seats.fish [--check])"
            exit 2
    end
end
test $dry -eq 1; and echo "[--check] verifying only; nothing will be written."

set -l retention ""
if test -f $shared_claude/settings.json
    set retention (jq -r '.cleanupPeriodDays // empty' $shared_claude/settings.json 2>/dev/null)
    or begin
        echo "! $shared_claude/settings.json is not valid JSON, so cleanupPeriodDays is unknown."
        exit 1
    end
end

set -g all_skills

set -l paseo_skills
set -l paseo_bin (command -v paseo)
test -n "$paseo_bin"
and set paseo_skills (path resolve (path dirname (path resolve $paseo_bin))/../node_modules/@getpaseo/server/dist/server/skills)
if not test -d "$paseo_skills"; and command -q npm
    set -l npm_root (npm root -g 2>/dev/null)
    set paseo_skills $npm_root/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/skills \
        $npm_root/@getpaseo/server/dist/server/skills
end
for skill in $paseo_skills/*/
    test -f $skill/SKILL.md; and set -a all_skills (path basename $skill)=(path resolve $skill)
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

for role in lead supervisor watcher
    set -l file $kit/claude/$role.settings.json
    if not jq -e . $file >/dev/null 2>&1
        fail "$file is not valid JSON; fix it by hand."
        continue
    end
    set -l days (jq -r '.cleanupPeriodDays // empty' $file)
    test "$days" = "$retention"
    or fail "$file: cleanupPeriodDays is '$days' but yours is '$retention'; set the same value in the file by hand."
end
function need_hook --argument-names role guard why
    jq -e --arg g $guard '[.hooks.PreToolUse[]?.hooks[]?.command] | any(test($g))' $kit/claude/$role.settings.json >/dev/null 2>&1
    or fail "claude/$role.settings.json has no PreToolUse hook running $guard, so nothing stops $why."
end
need_hook lead lead-guard.sh "a Lead from writing code"
need_hook lead profile-guard.sh "a Lead from launching an agent on the wrong model"
need_hook supervisor lead-guard.sh "a Supervisor from writing outside .seatworks/"
need_hook supervisor profile-guard.sh "a Supervisor from launching an agent on the wrong model"
need_hook watcher lead-guard.sh "the watcher from writing outside its attention log"
need_hook watcher watcher-guard.sh "the watcher from prompting agents it must not message"

set -l paseo_ok 0
if not test -f $paseo_config
    echo "  · $paseo_config not found; skipping the provider checks and the projects."
else if not jq -e . $paseo_config >/dev/null 2>&1
    fail "$paseo_config is not valid JSON; leaving it untouched."
else
    set paseo_ok 1
    jq -e '.daemon.mcp.injectIntoAgents == true' $paseo_config >/dev/null 2>&1
    or fail "daemon.mcp.injectIntoAgents is not true in $paseo_config, so the Lead and Supervisor get no Paseo tools."
end

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
    seat_link $profiles_root/claude-supervisor-$slug/lead-guard.sh $kit/claude/lead-guard.sh $dry
    seat_link $profiles_root/claude-supervisor-$slug/profile-guard.sh $kit/claude/profile-guard.sh $dry
    claude_provider claude-supervisor-$slug $profiles_root/claude-supervisor-$slug $deny_supervisor
    test (jq -r --arg k claude-supervisor-$slug '.agents.providers[$k].env.SEATWORKS_KIT // ""' $paseo_config) = $kit
    or fail "provider claude-supervisor-$slug: env.SEATWORKS_KIT is not $kit; rerun: fish $kit/setup/add-project.fish $repo_dir"
    build_claude_seat claude-lead-$slug $profiles_root/claude-lead-$slug $seat/LEAD.md \
        $kit/claude/lead.settings.json $seat/skills/lead $lead_extra_skills
    seat_link $profiles_root/claude-lead-$slug/lead-guard.sh $kit/claude/lead-guard.sh $dry
    seat_link $profiles_root/claude-lead-$slug/profile-guard.sh $kit/claude/profile-guard.sh $dry
    claude_provider claude-lead-$slug $profiles_root/claude-lead-$slug $deny_lead
    build_peer_seat pi-peer-$slug $pi_profiles_root/pi-peer-$slug $seat/PEER.md \
        $seat/skills/peer $peer_extra_skills
    peer_provider pi-peer-$slug $pi_profiles_root/pi-peer-$slug
    if optional_seat pi-peer-ro-$slug $repo_dir
        build_peer_seat pi-peer-ro-$slug $pi_profiles_root/pi-peer-ro-$slug $seat/PEER.md \
            $seat/skills/peer $peer_extra_skills
        peer_provider pi-peer-ro-$slug $pi_profiles_root/pi-peer-ro-$slug
        read_only_provider pi-peer-ro-$slug
    end
    if optional_seat pi-reviewer-$slug $repo_dir
        build_peer_seat pi-reviewer-$slug $pi_profiles_root/pi-reviewer-$slug $seat/REVIEWER.md \
            $seat/skills/reviewer $reviewer_extra_skills
        peer_provider pi-reviewer-$slug $pi_profiles_root/pi-reviewer-$slug
        read_only_provider pi-reviewer-$slug
    end
    if optional_seat claude-watcher-$slug $repo_dir
        build_claude_seat claude-watcher-$slug $profiles_root/claude-watcher-$slug $seat/WATCHER.md \
            $kit/claude/watcher.settings.json $seat/skills/watcher $watcher_extra_skills
        seat_link $profiles_root/claude-watcher-$slug/lead-guard.sh $kit/claude/lead-guard.sh $dry
        seat_link $profiles_root/claude-watcher-$slug/watcher-guard.sh $kit/claude/watcher-guard.sh $dry
        claude_provider claude-watcher-$slug $profiles_root/claude-watcher-$slug $deny_watcher
    end
end

set -l leaked (count $local_skills/*/SKILL.md)
test $leaked -gt 0
and echo "  · Pi also gives every Peer the $leaked skill(s) in $local_skills."

echo ""
echo "After changing providers in $paseo_config, run `paseo reload`; there is no file watcher."
echo "Running agents keep their old prompt and guards until they end: archive them and delete"
echo "their schedules and heartbeats. New seats pick up prompts, settings, and skills."

if test $errs -ne 0
    echo ""
    echo "! $errs error(s) above; the seats are not in the intended state."
    exit 1
end
