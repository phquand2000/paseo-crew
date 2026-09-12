#!/usr/bin/env fish

set -g kit (path resolve (path dirname (status filename))/..)
set -g seats_file  $kit/seats.json
set -g harness_dir $kit/harness
set -g paseo_config (test -n "$SEATWORKS_PASEO_CONFIG"; and echo $SEATWORKS_PASEO_CONFIG; or echo $HOME/.paseo/config.json)
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

function hidden_words --argument-names label file words
    test (count $argv[3..-1]) -gt 0; or return
    set -l pattern (string join '|' $argv[3..-1])
    set -l hit (grep -oiwE -- $pattern $file | sort -u | string join ', ')
    test -n "$hit"; and fail "$label: "(string replace -- "$kit/" '' $file)" names $hit, which this seat never sees. seats.json lists the words under hidesWords."
end

function check_skill --argument-names label skill
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
    for ph in $all_placeholders
        grep -qF -- $ph $file
        and fail "$label: skill $name uses the placeholder $ph, which only the harness that defines it substitutes; a skill has to load unchanged everywhere"
    end
    test (wc -l <$file) -ge 500
    and echo "  · $label: skill $name has 500+ lines; move detail into references/."
    grep -rq --include='*.md' '<!--' $skill
    and fail "$label: skill $name has an HTML comment in a .md file; a skill loads unchanged on every harness, and one that shows comments would read it to the seat as a rule. A script is run rather than read, so its own output may contain one."

    for file in (find $skill -type f -name '*.md')
        hidden_words $label $file $argv[3..-1]
        for link in (grep -oE '\]\((references|scripts)/[^)#]+' $file | string replace -r '^\]\(' '')
            test -e $skill/$link
            or fail "$label: skill $name links $link, which is not in its own directory; a reference a seat cannot open is a step it cannot take"
        end
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
    set -l cmd (harness_get $harness '.probe.command[]?')
    test (count $cmd) -gt 0; or return
    command -q $cmd[1]; or begin
        echo "  · $label: $cmd[1] is not on PATH, so the live probe was skipped."
        return
    end
    set -l env_var (harness_get $harness .configDirEnv)
    set -l creds
    if test (harness_get $harness '.probe.credentialFromBase // false') = true
        set -l var (harness_get $harness '.provider.baseCredential.env // empty')
        set -l base (harness_get $harness .baseProvider)
        if test -n "$var"
            set -l token (jq -r --arg b $base --arg v $var '.agents.providers[$b].env[$v] // ""' $paseo_config)
            if test -z "$token"
                fail "$label: the base provider `$base` has no $var, so the live probe can't log in."
                return
            end
            set creds $var=$token
        end
    end
    set -l names (env $env_var=$dir $creds $cmd \
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
    set -l hides (seat_field $role '.hidesWords[]?')
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
    grep -q '<!--' $prompt
    and fail "$key: $prompt contains an HTML comment; a prompt loads unchanged on every harness, and one that shows comments would read it to the seat as a rule. Maintainer notes go in WRITING_GUIDE.md."

    hidden_words $key $prompt $hides
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
            check_skill $key (path resolve $skill) $hides
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


function seat_deny_names --argument-names role harness
    begin
        for intent in (seat_intents $role)
            harness_get $harness ".deny.intents[\"$intent\"][]?"
        end
        seat_field $role '.deny[]?'
    end | string trim | string match -rv '^$' | sort -u
end

function seat_deny_flat --argument-names role harness
    printf '%s\n' (seat_deny_names $role $harness) | jq -R . | jq -s -c \
        --arg v (harness_get $harness '.deny.settingsValue') '
        map(select(length > 0) | {key: ., value: $v}) | from_entries'
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
            if not test -f $src
                fail "$key: $src not found"
                return
            end
            set -l path (harness_get $harness '.deny.settingsPath // empty')
            set -l map '{}'
            test -z "$path"; or set map (seat_deny_flat $role $harness)
            set -l target $dir/$file
            if not test -f $target; or not jq -e --slurpfile kit $src --arg p "$path" --argjson m "$map" '
                    . as $s
                    | ($p | split(".")) as $dp
                    | (if $p == "" then $s else ($s | delpaths([$dp])) end) as $sd
                    | (if $p == "" then $kit[0] else ($kit[0] | delpaths([$dp])) end) as $kd
                    | (if $p == "" then true else (($s | getpath($dp)) // {}) == $m end)
                      and ($kd | to_entries | all(.[]; $sd[.key] == .value))' $target >/dev/null 2>&1
                if test $dry -eq 1
                    fail "$key: $target is missing, lacks a key harness/$harness/"(harness_get $harness .settings.source)" sets, or holds a deny seats.json no longer gives $role (rerun without --check)"
                else
                    set -l base (mktemp)
                    if test -f $target
                        cp $target $base
                    else
                        echo '{}' >$base
                    end
                    set -l tmp (mktemp)
                    if jq -s --indent 2 --arg p "$path" --argjson m "$map" '
                            (.[0] * .[1])
                            | ($p | split(".")) as $dp
                            | if $p == "" then .
                              elif ($m | length) == 0 then delpaths([$dp])
                              else setpath($dp; $m) end' $base $src >$tmp
                        mv $tmp $target
                        echo "  ~ $key $file: keys from harness/$harness/"(harness_get $harness .settings.source)" and this seat's deny map, replacing any deny it no longer asks for"
                    else
                        rm -f $tmp
                        fail "$key: could not compose $target from harness/$harness/"(harness_get $harness .settings.source)" and the deny intents seats.json gives $role"
                    end
                    rm -f $base
                end
            end
        case '*'
            fail "$key: harness $harness declares settings.mode '$mode', which this script doesn't build"
    end
end

function build_seat_links --argument-names key harness dir
    set -l count (harness_get $harness '.links // [] | length')
    test $count -gt 0; or return
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
        jq -e --argjson servers (seats_get -c '.mcpServers // {}') "$check" $dir/$file >/dev/null 2>&1
        or fail "$key: $dir/$file fails the harness check `$check`; fix it."
        return
    end
    set -l servers (seats_get -c '.mcpServers // {}')
    if test $dry -eq 0
        test -n "$seed"; and begin
            test -e $dir/$file; or echo $seed >$dir/$file
        end
        test -n "$clear"; or return
        jq --argjson servers "$servers" "$clear" $dir/$file >$dir/$file.new
        and mv $dir/$file.new $dir/$file
        or begin
            rm -f $dir/$file.new
            fail "$key: $dir/$file is not valid JSON, so its MCP servers were not set."
        end
    else
        test -n "$check"; or return
        jq -e --argjson servers "$servers" "$check" $dir/$file >/dev/null 2>&1
        or fail "$key: $dir/$file is missing, broken, or does not carry exactly the MCP servers seats.json names."
    end
end

function build_seat_guards --argument-names key harness role dir
    set -l gdir (harness_get $harness .guards.dir)
    set -l into (harness_get $harness .guards.installTo)
    set -l bridge (harness_get $harness '.guards.shellBridge // empty')
    set -l want
    for guard in (seat_field $role '.guards[]?')
        if test -n "$bridge"; and string match -q '*.sh' -- $guard
            if not test -f $harness_dir/common/guards/$guard
                fail "$key: seats.json asks for shell guard $guard, which is not in harness/common/guards/; harness $harness runs it through "(harness_get $harness .guards.shellBridge)" from the kit."
                continue
            end
            contains -- $bridge $want; or set -a want $bridge
            continue
        end
        contains -- $guard $want; or set -a want $guard
    end
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

function seat_provider --argument-names role
    set -l key $role
    set -l harness (seat_field $role .harness)
    if not jq -e --arg k $key '.agents.providers[$k]' $paseo_config >/dev/null 2>&1
        if test $dry -eq 1
            fail "$paseo_config has no provider `$key`; rerun without --check."
            return
        end
        paseo_write $paseo_config "provider $key: created" \
            '.agents.providers[$k] = {extends: $b, label: $l, description: $d, env: {}}' \
            --arg k $key --arg b (harness_get $harness .baseProvider) \
            --arg l (seat_field $role .label) --arg d (seat_field $role .description)
    end
    provider_models $key $role
    set -l mine (harness_get $harness '.provider.env | keys[]?')
    for other in (all_harnesses)
        provider_env_absent $key (harness_get $other .configDirEnv)
        test $other = $harness; and continue
        for name in (harness_get $other '.provider.env | keys[]?')
            contains -- $name $mine; and continue
            provider_env_absent $key $name
        end
    end
    for name in SEATWORKS_REPO SEATWORKS_SLUG SEATWORKS_SEAT
        provider_env_absent $key $name
    end
    for name in $mine
        provider_env $key $name (harness_get $harness ".provider.env[\"$name\"]")
    end
    provider_command $key (jq -c --arg kit $kit '[(.provider.command // [])[]
        | gsub("KIT"; $kit)]' (harness_file $harness))
    provider_env $key SEATWORKS_ROLE $role
    provider_env $key SEATWORKS_KIT $kit
    if test (harness_get $harness .deny.mechanism) = settings
        provider_env $key SEATWORKS_DENIED_TOOLS (string join ':' (seat_deny_names $role $harness))
    else
        provider_env_absent $key SEATWORKS_DENIED_TOOLS
    end
    set -l hidden (seat_field $role '[.hidesPaths[]?] | join(":")')
    if test -n "$hidden"
        provider_env $key SEATWORKS_HIDDEN_PATHS $hidden
    else
        provider_env_absent $key SEATWORKS_HIDDEN_PATHS
    end
    test (seat_field $role .readOnly) = true
    and provider_env $key SEATWORKS_READ_ONLY 1
    provider_env_absent $key SEATWORKS_HOOK_PROTOCOL
    seat_deny $key $role $harness
    report_unenforced $key $role $harness
end

function provider_models --argument-names key role
    set -l want (seat_field $role '[.models[]?]' | jq -c .)
    test "$want" = '[]'; and return
    set -l have (jq -c --arg k $key '.agents.providers[$k].models // []' $paseo_config)
    test "$have" = "$want"; and return
    if test $dry -eq 1
        fail "provider $key does not offer the models seats.json names for $role (rerun without --check)"
        return
    end
    paseo_write $paseo_config "provider $key: models set from seats.json" \
        '.agents.providers[$k].models = $m' --arg k $key --argjson m "$want"
end

function seat_profile --argument-names role
    set -l harness (seat_field $role .harness)
    set -l want (jq -n --slurpfile s $seats_file --slurpfile h (harness_file $harness) --arg r $role '
        def dflt: (map(select(.isDefault == true)) + .)[0];
        ($s[0].seats[] | select(.role == $r)) as $seat
        | $h[0] as $hx
        | ($seat.models | if length > 0 then dflt else null end) as $d
        | { id: $r, name: $seat.label, provider: $r }
          + (if $d then { model: $d.id }
             elif $hx.provider.defaultModel then { model: $hx.provider.defaultModel }
             else {} end)
          + (if $hx.provider.profileModeId then { modeId: $hx.provider.profileModeId } else {} end)
          + (($d.thinkingOptions // [] | dflt.id) as $t
             | if $t then { thinkingOptionId: $t }
               elif $seat.thinking then { thinkingOptionId: $seat.thinking }
               else {} end)
          + { notes: $seat.notes }')
    set -l have (jq -c --arg r $role '[(.daemon.agentProfiles // [])[] | select(.id == $r)][0] // null' $paseo_config)
    test "$have" = (echo $want | jq -c .); and return
    if test $dry -eq 1
        fail "agent profile $role is missing or differs from seats.json (rerun without --check)"
        return
    end
    paseo_write $paseo_config "agent profile $role: set from seats.json" \
        '.daemon.agentProfiles = (((.daemon.agentProfiles // []) | map(select(.id != $p.id))) + [$p])' \
        --argjson p "$want"
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

function seat_intents --argument-names role
    begin
        seats_get '.denyCommonIntents[]?'
        seat_field $role '.denyIntents[]?'
    end | sort -u
end

function report_unenforced --argument-names key role harness
    set -l gaps
    for intent in (seat_intents $role)
        test (count (harness_get $harness ".deny.intents[\"$intent\"][]?")) -gt 0; and continue
        contains -- $intent (harness_get $harness '.deny.enforcedByGuard[]?'); and continue
        contains -- $intent (harness_get $harness '.deny.absent[]?'); and continue
        set -a gaps $intent
    end
    test (count $gaps) -eq 0; and return
    echo "  · $key: harness $harness enforces none of "(string join ', ' $gaps)". seats.json asks for "(count (seat_intents $role))" limits; "(count $gaps)" rest on the prompt alone."
end

function seat_deny --argument-names key role harness
    switch (harness_get $harness .deny.mechanism)
        case disallowedTools
            set -l want (begin
                for intent in (seat_intents $role)
                    harness_get $harness ".deny.intents[\"$intent\"][]?"
                end
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
            test "$have" = "$want"; and return
            set -l dead (echo $have | jq -c --argjson w "$want" '. - $w')
            set -l lack (echo $have | jq -c --argjson w "$want" '$w - .')
            set -l note
            test "$dead" != '[]'; and set -a note "drops "(echo $dead | jq -r 'join(", ")')", which seats.json no longer lists"
            test "$lack" != '[]'; and set -a note "adds "(echo $lack | jq -r 'join(", ")')
            if test $dry -eq 1
                fail "provider $key's deny list differs from seats.json: it "(string join ' and ' $note)" (rerun without --check)"
                return
            end
            paseo_write $paseo_config "provider $key: disallowedTools set from seats.json, which "(string join ' and ' $note) \
                '.agents.providers[$k].disallowedTools = $d' --arg k $key --argjson d "$want"
        case settings
            jq -e --arg k $key '(.agents.providers[$k].disallowedTools // []) == []' $paseo_config >/dev/null 2>&1
            and return
            if test $dry -eq 1
                fail "provider $key still carries a disallowedTools list, which harness $harness's agent never reads; its deny map belongs in the seat's "(harness_get $harness .settings.file)" (rerun without --check)"
            else
                paseo_write $paseo_config "provider $key: disallowedTools removed, which harness $harness does not read" \
                    'del(.agents.providers[$k].disallowedTools)' --arg k $key
            end
        case hooks
            echo "  · provider $key: harness $harness has no Paseo-side deny list, so its limits rest on its hooks and sandbox settings."
    end
end

function project_slug --argument-names repo_dir
    jq -r '.slug // empty' $repo_dir/.seatworks/project.json 2>/dev/null
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
set -l wanted
set -l i 1
while test $i -le (count $argv)
    switch $argv[$i]
        case --check
            set dry 1
        case --probe
            set live 1
        case --project
            set i (math $i + 1)
            set -l repo $argv[$i]
            test -d "$repo/.seatworks"
            or begin
                echo "! --project $repo has no .seatworks/; run setup/add-project.fish there first."
                exit 2
            end
            set -a wanted (path resolve $repo)
        case '*'
            echo "! unknown argument: $argv[$i] (usage: setup-seats.fish [--check] [--probe] [--project REPO_DIR]...)"
            exit 2
    end
    set i (math $i + 1)
end
test $dry -eq 1; and echo "[--check] verifying only; nothing will be written."
test $live -eq 1; and echo "[--probe] each seat's harness will be asked which skills it loads; this spends a cheap model call per seat that needs one."

for file in (find $kit/project -name '*.md' 2>/dev/null)
    grep -q '<!--' $file
    and fail (string replace -- "$kit/" '' $file)" contains an HTML comment. Every .md in this kit loads unchanged on every harness; put maintainer notes in WRITING_GUIDE.md."
end

for file in (find $kit/project -name '*.md' 2>/dev/null)
    for link in (grep -oE '\]\((references|scripts)/[^)#]+' $file | string replace -r '^\]\(' '')
        test -e (path dirname $file)/$link
        or fail (string replace -- "$kit/" '' $file)" links $link, which is not next to it; a reference a seat cannot open is a step it cannot take"
    end
    for link in (grep -oE '`\.seatworks/(skills|guides|prompts)/[^`]+`' $file | string trim -c '`')
        set -l rel (string replace '.seatworks/' '' $link)
        test -e $kit/project/$rel; and continue
        test $rel = guides/WORKSPACE_PROTOCOL.md; and test -f $kit/examples/WORKSPACE_PROTOCOL.md; and continue
        fail (string replace -- "$kit/" '' $file)" names $link, which neither project/ nor examples/ ships"
    end
end

for intent in (begin
        seats_get '.denyCommonIntents[]?'
        seats_get '.seats[].denyIntents[]?'
    end | sort -u)
    set -l because (seats_get --arg i $intent '.denyBecause[$i] // empty' | string collect)
    test -n "$because"
    or fail "seats.json denies '$intent' but records no reason for it under denyBecause. A limit nobody can review is a limit nobody can drop: write one line saying what it prevents."
end

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

set -g all_placeholders
for id in (all_harnesses)
    for ph in (harness_get $id '.skillLoad.placeholders[]?')
        contains -- $ph $all_placeholders; or set -a all_placeholders $ph
    end
end

for id in (seats_get '[.seats[].harness] | unique | .[]')
    test (harness_get $id '.settings.mode') = link; or continue
    set -l retention_key (harness_get $id '.settings.retentionKey // empty')
    set -l user_settings (expand_home (harness_get $id '.userSettings // empty'))
    set -l retention ""
    if test -n "$retention_key"; and test -f "$user_settings"
        set retention (jq -r --arg k $retention_key '.[$k] // empty' $user_settings 2>/dev/null)
        or begin
            echo "! $user_settings is not valid JSON, so $retention_key is unknown."
            exit 1
        end
    end
    set -l hook_key (harness_get $id '.guards.hookSettingsKey // empty')
    for role in (seats_get --arg h $id '.seats[] | select(.harness == $h) | .role')
        set -l file $harness_dir/$id/(string replace ROLE $role (harness_get $id '.settings.source'))
        test -f $file; or continue
        if not jq -e . $file >/dev/null 2>&1
            fail "$file is not valid JSON; fix it by hand."
            continue
        end
        if test -n "$retention_key"
            set -l days (jq -r --arg k $retention_key '.[$k] // empty' $file)
            test "$days" = "$retention"
            or fail "$file: $retention_key is '$days' but $user_settings has '$retention'; set the same value in the file by hand."
        end
        test -n "$hook_key"; or continue
        for guard in (seat_field $role '.guards[]?')
            jq -e --arg g $guard --arg k $hook_key '[getpath($k | split("."))[]?.hooks[]?.command] | any(test($g))' $file >/dev/null 2>&1
            or fail "$file has no $hook_key entry running $guard, so that guard never runs for the $role seat."
        end
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
set -l plugin_index ""
set -l plugin_manifest ""
for id in (all_harnesses)
    set -l candidate (expand_home (harness_get $id '.pluginIndex // empty'))
    test -n "$candidate"; and test -f "$candidate"; or continue
    set plugin_index $candidate
    set plugin_manifest (harness_get $id '.pluginManifest // empty')
    break
end
set -l plugin_root ""
test -n "$plugin_index"
and set plugin_root (jq -r --arg id $plugin_id '.plugins[$id][0].installPath // empty' $plugin_index 2>/dev/null)
if test -n "$plugin_root"; and test -d $plugin_root
    for rel in (jq -r '.skills[]?' $plugin_root/$plugin_manifest 2>/dev/null)
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
    if not jq -e '.daemon.mcp.enabled == true and .daemon.mcp.injectIntoAgents == true' $paseo_config >/dev/null 2>&1
        if test $dry -eq 1
            fail "daemon.mcp.enabled and daemon.mcp.injectIntoAgents are not both true in $paseo_config, so the Lead and Supervisor get no Paseo tools (rerun without --check)"
        else
            paseo_write $paseo_config "daemon.mcp: enabled and injected into agents" \
                '.daemon.mcp = ((.daemon.mcp // {}) + {enabled: true, injectIntoAgents: true})'
        end
    end
end

if test $paseo_ok -eq 1
    for role in (seats_get '.seats[].role')
        seat_provider $role
        seat_profile $role
    end
end

set -l projects $wanted
if test (count $projects) -eq 0
    for id in (seats_get '[.seats[].harness] | unique | .[]')
        set -l root (expand_home (harness_get $id .profileRoot))
        set -l prompt_file (harness_get $id .promptFile)
        test -d $root; or continue
        for dir in $root/*/
            test -L $dir/$prompt_file; or continue
            set -l repo (string replace -r '/\.seatworks/[^/]*$' '' -- (readlink $dir/$prompt_file))
            test -f $repo/.seatworks/project.json; or continue
            contains -- $repo $projects; or set -a projects $repo
        end
    end
end
test (count $projects) -eq 0
and echo "  · no projects yet; add one with: fish setup/add-project.fish REPO_DIR"

for repo_dir in $projects
    set -l slug (project_slug $repo_dir)
    if test -z "$slug"
        fail "$repo_dir/.seatworks/project.json names no slug, so its seat directories have no name; rerun: fish $kit/setup/add-project.fish $repo_dir"
        continue
    end
    for role in (seats_get '.seats[].role')
        build_seat $role $slug $repo_dir
    end
end

set -l known (seats_get '.seats[].role') (all_harnesses | while read -l id; harness_get $id .baseProvider; end)
for key in (jq -r '.agents.providers | keys[]' $paseo_config 2>/dev/null)
    contains -- $key $known; and continue
    set -l profiles (jq -r --arg k $key '[.daemon.agentProfiles[]? | select(.provider == $k)] | length' $paseo_config)
    echo "  · provider $key is not a role in seats.json, and $profiles profile(s) still point at it. A retired role's provider, profiles and seat directories are left alone, so nothing is deleted behind you: remove them yourself once no agent runs on them. list_profiles still offers it, and the profile guard refuses it by mayStart."
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
