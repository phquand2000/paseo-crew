#!/usr/bin/env fish

set -l kit (path resolve (path dirname (status filename))/..)
set -l paseo_config $HOME/.paseo/config.json
set -l seats_file $kit/seats.json
set -l harness_dir $kit/harness

set -l dry 1
for a in $argv
    switch $a
        case --apply
            set dry 0
        case '*'
            echo "! unknown argument: $a (usage: migrate-seat-names.fish [--apply])"
            exit 2
    end
end

command -q jq; or begin
    echo "! jq must be on PATH."
    exit 1
end
for file in $seats_file $paseo_config
    jq -e . $file >/dev/null 2>&1; or begin
        echo "! $file is missing or not valid JSON."
        exit 1
    end
end
test $dry -eq 1; and echo "[dry run] nothing will be written; rerun with --apply."

set -l pairs
set -l repos
set -l claimed
for role in (jq -r '.seats[].role' $seats_file | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)
    set -l harness (jq -r --arg r $role '.seats[] | select(.role == $r) | .harness' $seats_file)
    set -l base (jq -r '.baseProvider' $harness_dir/$harness/harness.json)
    set -l root (string replace -r '^HOME' $HOME (jq -r '.profileRoot' $harness_dir/$harness/harness.json))
    set -l env_var (jq -r '.configDirEnv' $harness_dir/$harness/harness.json)
    for old in (jq -r --arg p "$base-$role-" '.agents.providers | keys[] | select(startswith($p))' $paseo_config)
        contains -- $old $claimed; and continue
        set -a claimed $old
        set -l slug (string replace "$base-$role-" '' -- $old)
        set -l new $role-$slug
        set -a pairs "$old=$new=$root=$env_var"
        set -l repo (jq -r --arg k $old '.agents.providers[$k].env.SEATWORKS_REPO // ""' $paseo_config)
        test -n "$repo"; and not contains -- $repo $repos; and set -a repos $repo
    end
end

if test (count $pairs) -eq 0
    echo "Nothing to migrate: no provider is named <harness>-<role>-<slug>."
    exit 0
end

echo ""
echo "Providers and profile directories to rename:"
for pair in $pairs
    set -l parts (string split '=' $pair)
    echo "  $parts[1] → $parts[2]"
    test -d $parts[3]/$parts[1]
    and echo "    $parts[3]/$parts[1] → $parts[3]/$parts[2]"
    jq -e --arg k $parts[2] '.agents.providers[$k]' $paseo_config >/dev/null 2>&1
    and echo "    ! provider $parts[2] already exists; resolve that by hand before applying."
end
echo ""
echo "Projects whose .seatworks/ files name the old seats:"
for repo in $repos
    echo "  $repo"
end

if test $dry -eq 1
    echo ""
    echo "Run with --apply to make these changes. Archive every running agent first: a running seat keeps its old profile path."
    exit 0
end

set -l bak $paseo_config.bak.(date +%Y%m%d-%H%M%S)
cp $paseo_config $bak
chmod 600 $bak
echo "  ~ backed up $paseo_config to $bak"

for pair in $pairs
    set -l parts (string split '=' $pair)
    set -l old $parts[1]
    set -l new $parts[2]
    set -l root $parts[3]
    set -l env_var $parts[4]
    if test -d $root/$old
        if test -e $root/$new
            echo "  ! $root/$new already exists; left $root/$old in place."
        else
            mv $root/$old $root/$new
            echo "  ~ $root/$old → $root/$new"
        end
    end
    set -l tmp $paseo_config.new
    jq --arg o $old --arg n $new --arg v $env_var --arg d $root/$new '
        (.agents.providers[$o]) as $p
        | if $p == null then . else
            .agents.providers[$n] = ($p | .env[$v] = $d)
            | del(.agents.providers[$o])
            | .daemon.agentProfiles = ((.daemon.agentProfiles // [])
                | map(if .provider == $o then .provider = $n
                      elif (.provider | startswith($o + "/")) then .provider = $n + (.provider | ltrimstr($o))
                      else . end))
          end' $paseo_config >$tmp
    and chmod 600 $tmp
    and mv $tmp $paseo_config
    and echo "  ~ provider $old → $new"
    or begin
        rm -f $tmp
        echo "  ! could not rename provider $old; restore $bak and stop."
        exit 1
    end
end

for repo in $repos
    test -d $repo/.seatworks; or continue
    set -l touched
    for pair in $pairs
        set -l parts (string split '=' $pair)
        for file in (grep -rlF -- $parts[1] $repo/.seatworks $repo/AGENTS.md 2>/dev/null)
            perl -pi -e "s/\Q$parts[1]\E/$parts[2]/g" $file
            contains -- $file $touched; or set -a touched $file
        end
    end
    if test (count $touched) -gt 0
        echo "  ~ renamed the seats in "(count $touched)" file(s) under $repo"
    end
end

echo ""
echo "Next: fish $kit/setup/setup-seats.fish --check, then paseo reload and paseo daemon restart."
