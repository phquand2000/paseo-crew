#!/usr/bin/env fish

set -g kit (path resolve (path dirname (status filename))/..)
set -g seats_file  $kit/seats.json
set -g harness_dir $kit/harness
set -g paseo_config $HOME/.paseo/config.json
set -g shared_claude $HOME/.claude
set -g local_skills  $HOME/.agents/skills
set -l plugin_id     mattpocock-skills@mattpocock

set -g stamp (date +%Y%m%d-%H%M%S)
set -g errs 0
set -g linked_count 0
set -g probed_count 0

function fail
    echo "  ! $argv"
    set -g errs (math $errs + 1)
end

function expand_home --argument-names value
    string replace -r '^(HOME|~)(/|$)' "$HOME\$2" -- $value
end

function seats_get
    jq -r $argv $seats_file
end

function seat_field --argument-names role filter
    jq -r --arg r $role ".seats[] | select(.role == \$r) | $filter" $seats_file
end

function harness_file --argument-names id
    echo $harness_dir/$id/harness.json
end

function all_harnesses
    for dir in $harness_dir/*/
        set -l id (path basename $dir)
        test -f $dir/harness.json; and echo $id
    end
end

function harness_get --argument-names id filter
    jq -r $filter (harness_file $id)
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

function check_budget --argument-names file budget
    set -l size (wc -c <$file | string trim)
    set -l pct (math "round($size * 100 / $budget)")
    if test $size -gt $budget
        fail "$file is $size bytes, $pct% of the $budget-byte budget. Cut it."
    else if test $pct -ge 85
        echo "  · $file is $size bytes, $pct% of the $budget-byte budget; nearly full."
    end
end

function check_skill --argument-names label skill comments hides
    set -l file $skill/SKILL.md
    set -l name (path basename $skill)
    set -l front (awk 'NR == 1 && $0 != "---" { exit } NR > 1 && $0 == "---" { exit } NR > 1 { print }' $file)
    contains -- "name: $name" $front
    or fail "$label: skill $name has no frontmatter line 'name: $name'"
    set -l desc (string match -r --groups-only '^description: *"?(.*?)"?$' -- $front)
    if test -z "$desc"
        fail "$label: skill $name has no description, so it is never offered to the seat"
    else if test (string length -- $desc) -gt 1024
        fail "$label: skill $name has a description over 1,024 characters"
    end
    grep -qE '\$ARGUMENTS|\$\{CLAUDE_SKILL_DIR\}' $file
    and fail "$label: skill $name uses \$ARGUMENTS or \${CLAUDE_SKILL_DIR}, which only some harnesses substitute"
    test (wc -l <$file) -ge 500
    and echo "  · $label: skill $name has 500+ lines; move detail into references/."
    if test "$comments" = shown
        grep -rq '<!--' $skill
        and fail "$label: skill $name contains an HTML comment, which this seat's harness shows to the seat"
    end
    if test "$hides" = true
        grep -rqiwE 'paseo|supervisor|watcher|seats?' $skill
        and fail "$label: skill $name mentions the orchestration layer, which this seat doesn't know"
    end
end

function seat_skill_entries --argument-names label skills_dir
    if test -n "$skills_dir"
        for skill in $skills_dir/*/
            set skill (path resolve $skill)
            test -f $skill/SKILL.md; and echo (path basename $skill)=$skill
        end
    end
    for name in $argv[3..-1]
        if string match -q 'peer:*' -- $name
            test -n "$skills_dir"; or begin
                fail "$label: extra skill '$name' needs a skill set to resolve against, and this role's skills is null" >&2
                continue
            end
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

function link_skills --argument-names label dir skills_sub dry
    set -l linked
    for entry in $argv[5..-1]
        set -l parts (string split -m1 '=' $entry)
        seat_link $dir/$skills_sub/$parts[1] $parts[2] $dry
        set -a linked $parts[1]
    end
    for name in (command ls -1 $dir/$skills_sub 2>/dev/null)
        contains -- $name $linked; and test -e $dir/$skills_sub/$name; and continue
        if test $dry -eq 1
            fail "$label: leftover or dangling skill: $name"
        else
            rm -f $dir/$skills_sub/$name
        end
    end
    set -g linked_count (count $linked)
    set -g linked_names $linked
end

function probe_skills --argument-names label harness dir skills_sub repo_dir
    set -g probed_count -1
    switch (harness_get $harness .probe.kind)
        case pi-loader
            command -q node; or return
            set -l entry (probe_pi_entry)
            test -n "$entry"; or return
            set -l script (mktemp /tmp/seatworks-probe.XXXXXX.mjs)
            printf '%s\n' \
                'const { loadSkills } = await import(process.env.SEATWORKS_PROBE_ENTRY);' \
                'const r = loadSkills({ cwd: process.env.SEATWORKS_PROBE_CWD, agentDir: process.env.SEATWORKS_PROBE_DIR, skillPaths: [], includeDefaults: true });' \
                'for (const s of r.skills) console.log(s.name);' \
                'for (const d of r.diagnostics) console.error(`${d.type}: ${d.message} (${d.path ?? ""})`);' >$script
            set -l names (SEATWORKS_PROBE_DIR=$dir SEATWORKS_PROBE_CWD=$repo_dir SEATWORKS_PROBE_ENTRY=$entry node $script 2>/dev/null)
            set -l ok $status
            rm -f $script
            test $ok -eq 0; or return
            compare_probe $label $names
        case version
            set -l want (harness_get $harness '.verified // empty')
            set -l cmd (harness_get $harness '.versionCommand // empty')
            test -n "$want"; and test -n "$cmd"; or return
            set -l have (eval $cmd 2>/dev/null | string match -r '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
            test -n "$have"; or return
            test "$have" = "$want"
            or echo "  · $label: harness/$harness/harness.json records its skills directory as verified on $harness $want, and this machine runs $have. Rerun with --probe, then update the manifest's verified field."
        case unverified
            echo "  · $label: harness/$harness/harness.json has verified: null, so no skill probe ran; work through harness/$harness/NOTES.md first."
    end
end

function probe_live --argument-names label harness dir skills_sub repo_dir
    test (harness_get $harness .probe.kind) = version; or return
    command -q claude; or begin
        echo "  · $label: claude is not on PATH, so the live probe was skipped."
        return
    end
    set -l env_var (harness_get $harness .configDirEnv)
    set -l base (harness_get $harness .baseProvider)
    set -l token (jq -r --arg b $base '.agents.providers[$b].env.CLAUDE_CODE_OAUTH_TOKEN // ""' $paseo_config)
    if test -z "$token"
        fail "$label: the base provider `$base` has no CLAUDE_CODE_OAUTH_TOKEN, so the live probe can't log in."
        return
    end
    set -l names (env $env_var=$dir CLAUDE_CODE_OAUTH_TOKEN=$token claude -p --model claude-haiku-4-5-20251001 \
        'List every skill name in your available skills, one per line, nothing else.' 2>/dev/null |
        string trim | string replace -r '^[-*]\s*' '' | string replace -r '\s.*$' '')
    if test (count $names) -eq 0
        fail "$label: the live probe returned no skill names; check that $env_var reaches the harness."
        return
    end
    set -l want_offered
    set -l hidden 0
    for want in $linked_names
        if grep -qE '^disable-model-invocation: *true *$' $dir/$skills_sub/$want/SKILL.md 2>/dev/null
            set hidden (math $hidden + 1)
            contains -- $want $names
            and fail "$label: $harness offers '$want' to the model although its frontmatter says disable-model-invocation: true."
        else
            set -a want_offered $want
        end
    end
    set -l missing
    for want in $want_offered
        contains -- $want $names
        or set -a missing $want
    end
    if test (count $missing) -gt 0
        fail "$label: $harness does not offer the linked skill(s) "(string join ', ' $missing)"; its skills directory or that skill's frontmatter is wrong."
        return
    end
    echo "  · $label: live probe saw "(count $names)" skills and offers all "(count $want_offered)" the kit linked for the model"(test $hidden -gt 0; and echo ", holding $hidden back as disable-model-invocation"; or echo "")"."
end

function probe_pi_entry
    set -l bin (command -v pi)
    test -n "$bin"; or return
    set -l root (path resolve (path dirname (path resolve $bin))/../lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js)
    test -f $root; and echo $root; and return
    command -q npm; or return
    set -l entry (npm root -g 2>/dev/null)/@earendil-works/pi-coding-agent/dist/index.js
    test -f $entry; and echo $entry
end

function compare_probe --argument-names label
    set -l found $argv[2..-1]
    set -g probed_count (count $found)
    for want in $linked_names
        contains -- $want $found
        or fail "$label: the harness does not load the linked skill '$want'; its skills directory or frontmatter is wrong"
    end
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

function build_seat --argument-names role slug repo_dir
    set -l key $role-$slug
    set -l harness (seat_field $role .harness)
    set -l manifest (harness_file $harness)
    if not test -f $manifest
        fail "$key: seats.json sends role $role to harness '$harness', which has no $manifest"
        return
    end
    set -l dir (expand_home (harness_get $harness .profileRoot))/$key
    set -l prompt $repo_dir/.seatworks/(seat_field $role .prompt)
    set -l skills_name (seat_field $role .skills)
    set -l skills_dir ""
    test "$skills_name" = null; or set skills_dir $repo_dir/.seatworks/skills/$skills_name
    set -l extras (seat_field $role '.extraSkills[]?')
    set -l comments (harness_get $harness .promptComments)
    set -l hides (seat_field $role .hidesOrchestration)
    set -l skills_sub (harness_get $harness .skillsDir)
    set -l prompt_file (harness_get $harness .promptFile)
    set -l err0 $errs
    set -g linked_count 0
    set -g linked_names

    if not test -f $prompt
        fail "$key: $prompt not found"
        echo "✗ $key → $dir (see the ! lines above)"
        return
    end
    if test "$comments" = shown
        grep -q '<!--' $prompt
        and fail "$key: $prompt contains an HTML comment, which $harness shows to the seat."
    end
    if test "$hides" = true
        grep -qiwE 'paseo|supervisor|watcher|seats?' $prompt
        and fail "$key: $prompt mentions the orchestration layer, which this seat doesn't know."
    end
    check_budget $prompt (seats_get .promptBudget)

    test $dry -eq 0; and mkdir -p $dir/$skills_sub
    if not test -d $dir/$skills_sub
        fail "$key: $dir/$skills_sub is missing"
        echo "✗ $key → $dir (see the ! lines above)"
        return
    end

    seat_link $dir/$prompt_file $prompt $dry
    build_seat_settings $key $harness $role $dir
    build_seat_links $key $harness $dir
    build_seat_state $key $harness $dir
    build_seat_guards $key $harness $role $dir

    if test -n "$skills_dir"; and not test -d $skills_dir
        fail "$key: seats.json gives role $role the skill set '$skills_name', but $skills_dir does not exist. Fix the name, or set skills to null for a role with no own skills."
        echo "✗ $key → $dir (see the ! lines above)"
        return
    end
    if test -n "$skills_dir"
        for skill in $skills_dir/*/
            check_skill $key (path resolve $skill) $comments $hides
        end
    end
    link_skills $key $dir $skills_sub $dry (seat_skill_entries $key $skills_dir $extras)
    probe_skills $key $harness $dir $skills_sub $repo_dir
    test $live -eq 1; and probe_live $key $harness $dir $skills_sub $repo_dir

    set -l probe_note ""
    if test $probed_count -ge 0
        set probe_note ", $probed_count loaded"
    end
    test $errs -eq $err0
    and echo "✓ $key → $dir ($linked_count skills$probe_note)"
    or echo "✗ $key → $dir (see the ! lines above)"
end

function env_pairs --argument-names key harness
    jq -r -n --slurpfile m (harness_file $harness) --slurpfile p $paseo_config --arg k $key '
        (($m[0].provider.env // {}) + (($p[0].agents.providers[$k].env // {})
            | with_entries(select(.key | startswith("SEATWORKS_CODEX_")))))
        | to_entries[] | select(.key | startswith("SEATWORKS_CODEX_")) | "\(.key)=\(.value)"'
end

function build_seat_settings --argument-names key harness role dir
    set -l mode (harness_get $harness .settings.mode)
    set -l file (harness_get $harness .settings.file)
    set -l src $harness_dir/$harness/(string replace ROLE $role (harness_get $harness .settings.source))
    switch $mode
        case link
            if not test -f $src
                fail "$key: $src not found"
                return
            end
            seat_link $dir/$file $src $dry
        case merge
            set -l target $dir/$file
            if not test -f $target; or not jq -e --slurpfile kit_keys $src \
                    '. as $s | $kit_keys[0] | to_entries | all(.[]; $s[.key] == .value)' $target >/dev/null 2>&1
                if test $dry -eq 1
                    fail "$key: $target is missing or lacks the keys in harness/$harness/"(harness_get $harness .settings.source)" (rerun without --check)"
                else
                    set -l tmp (mktemp)
                    if test -f $target
                        jq -s --indent 2 '.[0] * .[1]' $target $src >$tmp
                    else
                        jq --indent 2 . $src >$tmp
                    end
                    and mv $tmp $target
                    and echo "  ~ $key $file: merged harness/$harness/"(harness_get $harness .settings.source)
                    or begin
                        rm -f $tmp
                        fail "$key: could not write $target"
                    end
                end
            end
        case toml-overlay
            if not test -f $src
                fail "$key: $src not found; write a per-role overlay for $role before this seat can be built"
                return
            end
            set -l base $harness_dir/$harness/(harness_get $harness '.settings.base // empty')
            test -f $base
            or fail "$key: harness $harness declares no settings.base, so the room has no provider block to write"
            set -l key_var (jq -r --arg k $key '.agents.providers[$k].env.SEATWORKS_CODEX_ENV_KEY // ""' $paseo_config)
            if test -n "$key_var"
                grep -rqE '(experimental_bearer_token|api[_-]?key)\s*=' $harness_dir/$harness/config/
                and fail "$key: harness $harness has a literal token in harness/$harness/config/; use env_key = \"$key_var\" and export the key instead."
                set -q $key_var
                or echo "  · $key: Codex reads its API key from \$$key_var, which is not set in this shell. Export it where the Paseo daemon can see it."
            end
            set -l mat $harness_dir/$harness/(harness_get $harness '.settings.materialize // empty')
            if not test -x $mat
                fail "$key: harness $harness declares settings.materialize, but $mat is not executable"
                return
            end
            if test $dry -eq 1
                test -f $dir/(harness_get $harness .settings.file)
                or fail "$key: $dir/"(harness_get $harness .settings.file)" is missing (rerun without --check)"
            else
                env SEATWORKS_KIT=$kit (env_pairs $key $harness) $mat $key $role $dir
                or fail "$key: $mat failed"
            end
        case '*'
            fail "$key: harness $harness declares settings.mode '$mode', which this script doesn't build"
    end
end

function build_seat_links --argument-names key harness dir
    set -l count (harness_get $harness '.links | length')
    for i in (seq 0 (math $count - 1))
        set -l link (harness_get $harness ".links[$i].link")
        set -l target (expand_home (harness_get $harness ".links[$i].target"))
        set -l required (harness_get $harness ".links[$i].required // empty")
        set -l optional (harness_get $harness ".links[$i].optional // false")
        if not test -e $target
            if test -n "$required"
                fail "$key: $target not found; $required."
                continue
            end
            if test "$optional" = true
                test $dry -eq 0; and test -L $dir/$link; and rm -f $dir/$link
                continue
            end
        end
        seat_link $dir/$link $target $dry
    end
end

function build_seat_state --argument-names key harness dir
    set -l file (harness_get $harness '.state.file // empty')
    test -n "$file"; or return
    set -l optional (harness_get $harness '.state.optional // false')
    set -l seed (harness_get $harness '.state.seed // empty')
    set -l clear (harness_get $harness '.state.clearMcp // empty')
    set -l check (harness_get $harness '.state.checkMcp // empty')
    for name in (harness_get $harness '.state.forbid[]?')
        test -e $dir/$name
        and fail "$key: $dir/$name exists; delete it."
    end
    if test "$optional" = true
        test -f $dir/$file; or return
        test -n "$check"; or return
        jq -e "$check" $dir/$file >/dev/null 2>&1
        or fail "$key: $dir/$file fails the harness check `$check`; fix it."
        return
    end
    if test $dry -eq 0
        test -n "$seed"; and begin
            test -e $dir/$file; or echo $seed >$dir/$file
        end
        test -n "$clear"; or return
        jq "$clear" $dir/$file >$dir/$file.new
        and mv $dir/$file.new $dir/$file
        or begin
            rm -f $dir/$file.new
            fail "$key: $dir/$file is not valid JSON, so its MCP servers were not cleared."
        end
    else
        test -n "$check"; or return
        jq -e "$check" $dir/$file >/dev/null 2>&1
        or fail "$key: $dir/$file is missing, broken, or still defines MCP servers."
    end
end

function build_seat_guards --argument-names key harness role dir
    set -l gdir (harness_get $harness .guards.dir)
    set -l into (harness_get $harness .guards.installTo)
    set -l want (seat_field $role '.guards[]?')
    if test "$into" != "."
        test $dry -eq 0; and mkdir -p $dir/$into
        if not test -d $dir/$into
            fail "$key: $dir/$into is missing"
            return
        end
    end
    set -l dest $dir
    test "$into" = "."; or set dest $dir/$into
    for guard in $want
        set -l src $harness_dir/$gdir/$guard
        if not test -f $src
            fail "$key: seats.json asks for guard $guard, which harness $harness doesn't ship at $src"
            continue
        end
        seat_link $dest/$guard $src $dry
    end
    if test (harness_get $harness .guards.hookProtocol) = extension
        for extra in (command ls -1 $dest 2>/dev/null)
            contains -- $extra $want; and continue
            test -L $dest/$extra; or continue
            string match -q "$harness_dir/*" (readlink $dest/$extra); or continue
            if test $dry -eq 1
                fail "$key: leftover guard extension: $extra"
            else
                rm -f $dest/$extra
            end
        end
    end
end

function seat_provider --argument-names role slug repo_dir
    set -l key $role-$slug
    set -l harness (seat_field $role .harness)
    set -l dir (expand_home (harness_get $harness .profileRoot))/$key
    set -l env_var (harness_get $harness .configDirEnv)
    if not jq -e --arg k $key '.agents.providers[$k]' $paseo_config >/dev/null 2>&1
        fail "$paseo_config has no provider `$key`."
        return
    end
    set -l have (jq -r --arg k $key --arg v $env_var '.agents.providers[$k].env[$v] // ""' $paseo_config)
    if test -n "$have"; and test (path resolve (expand_home $have)) != (path resolve $dir)
        echo "  · provider $key pointed $env_var at $have; this role's harness is $harness, so it moves to $dir."
    end
    provider_env $key $env_var $dir
    set -l mine (harness_get $harness '.provider.env | keys[]?')
    for other in (all_harnesses)
        test $other = $harness; and continue
        set -l stale (harness_get $other .configDirEnv)
        test "$stale" = "$env_var"; or provider_env_absent $key $stale
        for name in (harness_get $other '.provider.env | keys[]?')
            contains -- $name $mine; and continue
            provider_env_absent $key $name
        end
    end
    for name in $mine
        provider_env $key $name (harness_get $harness ".provider.env[\"$name\"]")
    end
    set -l cmd (jq -c --arg kit $kit --arg s $key '[(.provider.command // [])[]
        | gsub("KIT"; $kit) | gsub("SEAT"; $s)]' (harness_file $harness))
    provider_command $key $cmd
    provider_env $key SEATWORKS_REPO $repo_dir
    provider_env $key SEATWORKS_ROLE $role
    provider_env $key SEATWORKS_SEAT $key
    provider_env $key SEATWORKS_SLUG $slug
    if needs_kit_path $role $harness
        provider_env $key SEATWORKS_KIT $kit
    else
        provider_env_absent $key SEATWORKS_KIT
    end
    test (seat_field $role .readOnly) = true
    and provider_env $key SEATWORKS_READ_ONLY 1
    set -l protocol (harness_get $harness .guards.hookProtocol)
    if test "$protocol" = extension; or test "$protocol" = exit-code
        provider_env_absent $key SEATWORKS_HOOK_PROTOCOL
    else
        provider_env $key SEATWORKS_HOOK_PROTOCOL $protocol
    end
    seat_deny $key $role $harness
end

function needs_kit_path --argument-names role harness
    test (jq -r --arg r $role '[.skillGates[]? | select(.seat == $r)] | length' $seats_file) -gt 0
    and return 0
    test (harness_get $harness .guards.hookProtocol) = extension
    and return 1
    test (count (seat_field $role '.guards[]?')) -gt 0
end

function provider_command --argument-names key want
    set -l have (jq -c --arg k $key '.agents.providers[$k].command // []' $paseo_config)
    test "$have" = "$want"; and return
    if test $dry -eq 1
        if test "$want" = '[]'
            fail "provider $key still has a launcher command, which this harness does not use (rerun without --check)"
        else
            fail "provider $key lacks the launcher command "(echo $want | jq -r 'join(" ")')" (rerun without --check)"
        end
        return
    end
    if test "$want" = '[]'
        paseo_write $paseo_config "provider $key: launcher command removed" \
            'del(.agents.providers[$k].command)' --arg k $key
    else
        paseo_write $paseo_config "provider $key: launcher command set" \
            '.agents.providers[$k].command = $c' --arg k $key --argjson c "$want"
    end
end

function provider_env_absent --argument-names key name
    jq -e --arg k $key --arg n $name '.agents.providers[$k].env | has($n) | not' $paseo_config >/dev/null 2>&1
    and return
    if test $dry -eq 1
        fail "provider $key still sets env.$name, which this seat has no use for (rerun without --check)"
        return
    end
    paseo_write $paseo_config "provider $key: env.$name removed" \
        'del(.agents.providers[$k].env[$n])' --arg k $key --arg n $name
end

function provider_env --argument-names key name value
    test (jq -r --arg k $key --arg n $name '.agents.providers[$k].env[$n] // ""' $paseo_config) = "$value"
    and return
    if test $dry -eq 1
        fail "provider $key lacks env.$name=$value (rerun without --check)"
        return
    end
    paseo_write $paseo_config "provider $key: env.$name set" \
        '.agents.providers[$k].env[$n] = $v' --arg k $key --arg n $name --arg v $value
end

function seat_deny --argument-names key role harness
    switch (harness_get $harness .deny.mechanism)
        case disallowedTools
            set -l want (begin
                seats_get '.denyCommon[]'
                seat_field $role '.deny[]?'
            end | jq -R . | jq -s -c 'unique')
            set -l have (jq -c --arg k $key '(.agents.providers[$k].disallowedTools // []) | unique' $paseo_config)
            set -l retired (harness_get $harness '[.deny.retired[]?]' | jq -c .)
            set -l stale (echo $have | jq -c --argjson r "$retired" '[.[] | select(. as $x | $r | index($x))]')
            if test "$stale" != '[]'
                if test $dry -eq 1
                    fail "provider $key still denies "(echo $stale | jq -r 'join(", ")')", which this harness has retired: "(harness_get $harness '.deny.retiredNote // ""')" (rerun without --check)"
                else
                    set -l kept (echo $have | jq -c --argjson r "$retired" '[.[] | select(. as $x | $r | index($x) | not)]')
                    paseo_write $paseo_config "provider $key: retired deny entries removed" \
                        '.agents.providers[$k].disallowedTools = $d' --arg k $key --argjson d "$kept"
                    set have $kept
                end
            end
            set -l dead (echo $have | jq -c --argjson w "$want" '. - $w')
            test "$dead" != '[]'
            and echo "  · provider $key denies "(echo $dead | jq -r 'join(", ")')", which seats.json no longer lists; check for a stale or misspelled tool name."
            set -l lack (echo $have | jq -c --argjson w "$want" '$w - .')
            test "$lack" = '[]'; and return
            if test $dry -eq 1
                fail "provider $key lacks deny entries "(echo $lack | jq -r 'join(", ")')" (rerun without --check)"
                return
            end
            set -l merged (echo $have | jq -c --argjson w "$want" '($w + .) | unique')
            paseo_write $paseo_config "provider $key: disallowedTools updated" \
                '.agents.providers[$k].disallowedTools = $d' --arg k $key --argjson d "$merged"
        case extension
            test (harness_get $harness .deny.paseoToolsOff) = true; or return
            jq -e --arg k $key '.agents.providers[$k].paseoTools.enabled == false' $paseo_config >/dev/null 2>&1
            and return
            if test $dry -eq 1
                fail "provider $key gives the seat Paseo tools (rerun without --check)"
            else
                paseo_write $paseo_config "provider $key: paseoTools disabled" \
                    '.agents.providers[$k].paseoTools = ((.agents.providers[$k].paseoTools // {}) + {enabled: false})' --arg k $key
            end
        case hooks
            echo "  · provider $key: harness $harness has no Paseo-side deny list, so its limits rest on its hooks and sandbox settings."
    end
end

function optional_seat --argument-names key repo_dir
    jq -e --arg k $key '.agents.providers[$k]' $paseo_config >/dev/null 2>&1
    and return 0
    echo "  · $key doesn't exist yet; add it with: fish $kit/setup/add-project.fish $repo_dir"
    return 1
end

command -q jq; or begin
    echo "! jq must be on PATH."
    exit 1
end
for file in $seats_file $harness_dir/common/hook-io.sh
    test -f $file; or begin
        echo "! $file not found. Run the script from its original location in the kit."
        exit 1
    end
end
jq -e . $seats_file >/dev/null 2>&1; or begin
    echo "! $seats_file is not valid JSON; fix it by hand."
    exit 1
end

set -g dry 0
set -g live 0
for a in $argv
    switch $a
        case --check
            set dry 1
        case --probe
            set live 1
        case '*'
            echo "! unknown argument: $a (usage: setup-seats.fish [--check] [--probe])"
            exit 2
    end
end
test $dry -eq 1; and echo "[--check] verifying only; nothing will be written."
test $live -eq 1; and echo "[--probe] each seat's harness will be asked which skills it loads; this spends a cheap model call per seat that needs one."

for id in (seats_get '[.seats[].harness] | unique | .[]')
    set -l manifest (harness_file $id)
    if not test -f $manifest
        fail "seats.json uses harness '$id', which has no $manifest"
        continue
    end
    jq -e . $manifest >/dev/null 2>&1
    or fail "$manifest is not valid JSON; fix it by hand."
    test (harness_get $id '.verified // "null"') = null
    and echo "  · harness $id is unverified on this machine; read harness/$id/NOTES.md before you trust a seat on it."
    test (harness_get $id '.skillLoad.transcriptMatch // "null"') = null
    or continue
    test (harness_get $id .guards.hookProtocol) = extension
    and continue
    for role in (seats_get --arg h $id '.seats[] | select(.harness == $h) | .role')
        test (jq -r --arg r $role '[.skillGates[]? | select(.seat == $r)] | length' $seats_file) -gt 0
        and fail "seats.json gates the $role seat but sends it to harness $id, which has no way to tell a loaded skill from an unloaded one (skillLoad.transcriptMatch is null). Move the role to a harness whose gate holds, or settle that field first: harness/$id/NOTES.md."
    end
end
test $errs -eq 0; or exit 1

set -l retention ""
if test -f $shared_claude/settings.json
    set retention (jq -r '.cleanupPeriodDays // empty' $shared_claude/settings.json 2>/dev/null)
    or begin
        echo "! $shared_claude/settings.json is not valid JSON, so cleanupPeriodDays is unknown."
        exit 1
    end
end
for role in (seats_get '.seats[] | select(.harness == "claude") | .role')
    set -l file $harness_dir/claude/settings/$role.settings.json
    test -f $file; or continue
    if not jq -e . $file >/dev/null 2>&1
        fail "$file is not valid JSON; fix it by hand."
        continue
    end
    set -l days (jq -r '.cleanupPeriodDays // empty' $file)
    test "$days" = "$retention"
    or fail "$file: cleanupPeriodDays is '$days' but yours is '$retention'; set the same value in the file by hand."
    for guard in (seat_field $role '.guards[]?')
        jq -e --arg g $guard '[.hooks.PreToolUse[]?.hooks[]?.command] | any(test($g))' $file >/dev/null 2>&1
        or fail "$file has no PreToolUse hook running $guard, so that guard never runs for the $role seat."
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

set -l anchor (seats_get '.seats[] | select(.anchor == true) | .role')
set -l projects
test $paseo_ok -eq 1
and set projects (jq -r --arg a "$anchor-" '.agents.providers | to_entries[] | select(.key | startswith($a))
    | "\(.key | ltrimstr($a))=\(.value.env.SEATWORKS_REPO // "")"' $paseo_config)
test (count $projects) -eq 0
and echo "  · no projects yet; add one with: fish setup/add-project.fish REPO_DIR"

for entry in $projects
    set -l parts (string split -m1 '=' $entry)
    set -l slug $parts[1]
    set -l repo_dir $parts[2]
    if test -z "$repo_dir"; or not test -d $repo_dir/.seatworks
        fail "project $slug: $anchor-$slug has no env.SEATWORKS_REPO, or $repo_dir/.seatworks is missing; rerun setup/add-project.fish."
        continue
    end
    for role in (seats_get '.seats[].role')
        set -l key $role-$slug
        if test (seat_field $role .required) != true
            optional_seat $key $repo_dir; or continue
        end
        build_seat $role $slug $repo_dir
        seat_provider $role $slug $repo_dir
        if test (seat_field $role .carriesKitPath) = true
            test (jq -r --arg k $key '.agents.providers[$k].env.SEATWORKS_KIT // ""' $paseo_config) = $kit
            or fail "provider $key: env.SEATWORKS_KIT is not $kit; rerun: fish $kit/setup/add-project.fish $repo_dir"
        end
    end
end

set -l leaked (count $local_skills/*/SKILL.md)
if test $leaked -gt 0
    for id in (seats_get '[.seats[].harness] | unique | .[]')
        contains -- (expand_home $local_skills) (harness_get $id '.sharedSkillDirs[]?' | string replace -r '^HOME' $HOME)
        and echo "  · every $id seat also loads the $leaked skill(s) in $local_skills."
    end
end

echo ""
echo "After changing providers in $paseo_config, run `paseo reload`; there is no file watcher."
echo "Running agents keep their old prompt and guards until they end: archive them and delete"
echo "their schedules and heartbeats. New seats pick up prompts, settings, and skills."

if test $errs -ne 0
    echo ""
    echo "! $errs error(s) above; the seats are not in the intended state."
    exit 1
end
