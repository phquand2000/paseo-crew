#!/usr/bin/env fish

set -l kit (path resolve (path dirname (status filename))/..)
set -l paseo_config $HOME/.paseo/config.json
set -l seats_file $kit/seats.json
set -l harness_dir $kit/harness

set -l repo_dir ""
set -l slug ""
set -l model ""
set -l refresh 0
set -l i 1
while test $i -le (count $argv)
    switch $argv[$i]
        case --slug
            set i (math $i + 1)
            set slug $argv[$i]
        case --model
            set i (math $i + 1)
            set model $argv[$i]
        case --refresh
            set refresh 1
        case '-*'
            echo "! unknown option: $argv[$i]"
            exit 2
        case '*'
            set repo_dir $argv[$i]
    end
    set i (math $i + 1)
end

if test -z "$repo_dir"; or not test -d "$repo_dir"
    echo "usage: add-project.fish REPO_DIR [--slug SLUG] [--model MODEL (overrides each harness's provider.defaultModel, for roles whose seats.json entry names none)] [--refresh]"
    exit 2
end
set repo_dir (path resolve $repo_dir)
test -n "$slug"; or set slug (path basename $repo_dir)
set slug (string replace -ra '[^a-z0-9-]' '-' -- (string lower -- $slug))

command -q jq; or begin
    echo "! jq must be on PATH."
    exit 1
end
for file in $seats_file $kit/examples/paseo-providers.json
    test -f $file; or begin
        echo "! $file not found. Run the script from its original location in the kit."
        exit 1
    end
end
jq -e . $seats_file >/dev/null 2>&1; or begin
    echo "! $seats_file is not valid JSON; fix it by hand."
    exit 1
end

set -l roles (jq -r '.seats[].role' $seats_file)
set -l anchor (jq -r '.seats[] | select(.anchor == true) | .role' $seats_file)
set -l entry (jq -r '.seats[] | select(.entry == true) | .role' $seats_file)
set -l prompts (jq -r '[.seats[].prompt] | unique | .[]' $seats_file)
for short in $roles
    for long in $roles
        string match -q "$short-*" -- $long; or continue
        set -l rest (string replace "$short-" '' -- $long)
        test "$slug" = "$rest"; or string match -q "$rest-*" -- $slug; or continue
        echo "! the slug $slug would make $short-$slug unreadable: it is also how a $long seat is named. Pass --slug with another name."
        exit 2
    end
end

if not test -f $paseo_config; or not jq -e . $paseo_config >/dev/null 2>&1
    echo "! $paseo_config is missing or not valid JSON; finish SETUP.md steps 3 to 5 first."
    exit 1
end
git -C $repo_dir rev-parse --git-dir >/dev/null 2>&1; or begin
    echo "! $repo_dir is not a git repository, and the write guard checks paths only inside one; run git init there first."
    exit 1
end

set -l seat $repo_dir/.seatworks
set -l added

set -l other (jq -r --arg k $anchor-$slug '.agents.providers[$k].env.SEATWORKS_REPO // ""' $paseo_config)
if test -n "$other"; and test (path resolve $other) != $repo_dir
    echo "! the slug $slug already belongs to $other: pass --slug with another name."
    echo "  If that repository moved here, set env.SEATWORKS_REPO on $anchor-$slug to $repo_dir, then rerun."
    exit 1
end

for id in (jq -r '[.seats[].harness] | unique | .[]' $seats_file)
    set -l manifest $harness_dir/$id/harness.json
    if not test -f $manifest; or not jq -e . $manifest >/dev/null 2>&1
        echo "! seats.json uses harness '$id', whose $manifest is missing or not valid JSON."
        exit 1
    end
    set -l base (jq -r '.baseProvider' $manifest)
    jq -e --arg b $base '.agents.providers[$b]' $paseo_config >/dev/null 2>&1
    or begin
        echo "! $paseo_config has no base provider `$base`, which harness $id extends; add it from examples/paseo-providers.json (SETUP.md, \"Add the base providers to Paseo\")."
        exit 1
    end
end

set -l stage (mktemp -d)
cp -R $kit/project/. $stage/
awk '/^````md$/{f=1; next} /^````$/{f=0} f' $kit/examples/WORKSPACE_PROTOCOL.md >$stage/WORKSPACE_PROTOCOL.md
set -l seat_pattern (string join '|' $roles)
for file in $stage/*.md (find $stage/skills -type f -name '*.md')
    perl -pi -e "s/\b($seat_pattern)-SLUG\b/\$1-$slug/g" $file
end
set -l peer_harness (jq -r '.seats[] | select(.role == "peer") | .harness' $seats_file)
set -l peer_model $model
test -n "$peer_model"; or set peer_model (jq -r '.provider.defaultModel // ""' $harness_dir/$peer_harness/harness.json)
test -n "$peer_model"; and perl -pi -e "s|PEER_MODEL|$peer_model|g" $stage/WORKSPACE_PROTOCOL.md

set -l refreshed
set -l drafts $seat/records/drafts/refresh-(date +%Y%m%d-%H%M%S)
for src in (find $stage -type f ! -name .DS_Store ! -path '*/__pycache__/*')
    set -l rel (string replace -- "$stage/" '' $src)
    if test -e $seat/$rel
        test $refresh -eq 1; or continue
        contains -- $rel $prompts; or string match -q 'skills/*' -- $rel
        or begin
            test $rel = WORKSPACE_PROTOCOL.md; and grep -q STRICTNESS_LEVEL $seat/$rel
        end
        or continue
        cmp -s $src $seat/$rel; and continue
        mkdir -p (path dirname $drafts/$rel)
        cp $seat/$rel $drafts/$rel
        cp $src $seat/$rel
        set -a refreshed .seatworks/$rel
        continue
    end
    mkdir -p (path dirname $seat/$rel)
    cp $src $seat/$rel
    set -a added .seatworks/$rel
end
if test $refresh -eq 1; and test -d $seat/skills
    for old in (find $seat/skills -type f ! -name .DS_Store ! -path '*/__pycache__/*')
        set -l rel (string replace -- "$seat/" '' $old)
        test -e $stage/$rel; and continue
        mkdir -p (path dirname $drafts/$rel)
        mv $old $drafts/$rel
        set -a refreshed ".seatworks/$rel (retired)"
    end
    find $seat/skills -type d -empty -delete
end
rm -rf $stage

for line in (grep -v '^#' $kit/project/.gitignore)
    test -n "$line"; or continue
    grep -qxF -- $line $seat/.gitignore; and continue
    echo $line >>$seat/.gitignore
    set -a added ".seatworks/.gitignore ($line)"
end

if not test -e $repo_dir/AGENTS.md
    awk '/^````md$/{f=1; next} /^````$/{f=0} f' $kit/examples/AGENTS_MD_SNIPPET.md >$repo_dir/AGENTS.md
    set -a added AGENTS.md
end
for id in (jq -r '[.seats[].harness] | unique | .[]' $seats_file)
    set -l ctx (jq -r '.contextFile // "AGENTS.md"' $harness_dir/$id/harness.json)
    test $ctx = AGENTS.md; and continue
    test (jq -r '.contextFileNeedsPointer // false' $harness_dir/$id/harness.json) = true; or continue
    test -e $repo_dir/$ctx; and continue
    echo '@AGENTS.md' >$repo_dir/$ctx
    set -a added $ctx
end

set -l manifests (mktemp)
jq -n --arg dir $harness_dir '
    [$dir] | .[0] as $d | {}' >$manifests
for id in (jq -r '[.seats[].harness] | unique | .[]' $seats_file)
    set -l merged (mktemp)
    jq --arg id $id --slurpfile m $harness_dir/$id/harness.json '.[$id] = $m[0]' $manifests >$merged
    and mv $merged $manifests
    or begin
        rm -f $merged $manifests
        echo "! could not read the harness manifests"
        exit 1
    end
end

set -l new $paseo_config.new
if not jq --slurpfile seats $seats_file --slurpfile hs $manifests --arg h $HOME --arg s $slug \
        --arg r $repo_dir --arg kit $kit --arg m "$model" '
    def dflt: (map(select(.isDefault == true)) + .)[0];
    def home($p): ($p | sub("^HOME"; $h));
    ($s | ascii_upcase) as $n
    | $seats[0] as $cfg
    | $hs[0] as $H
    | reduce ($cfg.seats[]) as $seat (.;
        ($H[$seat.harness]) as $hx
        | "\($seat.role)-\($s)" as $key
        | ({ extends: $hx.baseProvider,
             label: "\($hx.label) \($seat.label) · \($s)",
             description: "\($seat.description) for \($s)",
             env: ($hx.provider.env
                   + { (($hx.configDirEnv)): "\(home($hx.profileRoot))/\($key)" }
                   + { SEATWORKS_REPO: $r, SEATWORKS_ROLE: $seat.role, SEATWORKS_SEAT: $key, SEATWORKS_SLUG: $s }
                   + (if (($hx.guards.hookProtocol != "extension" and ($seat.guards | length) > 0)
                          or ($cfg.skillGates | any(.seat == $seat.role)))
                      then { SEATWORKS_KIT: $kit } else {} end)
                   + (if $seat.readOnly then { SEATWORKS_READ_ONLY: "1" } else {} end)
                   + (if ($hx.guards.hookProtocol | IN("exit-code", "extension")) then {}
                      else { SEATWORKS_HOOK_PROTOCOL: $hx.guards.hookProtocol } end))
           }
           + $hx.provider.keys
           + (if ($hx.provider.command // []) | length > 0
              then { command: ($hx.provider.command
                     | map(gsub("KIT"; $kit) | gsub("SEAT"; $key))) }
              else {} end)
           + (if ($seat.models | length) > 0 then { models: $seat.models } else {} end)) as $t
        | .agents.providers[$key] |= if . == null then $t else
              .env += ($t.env | with_entries(select(.key | startswith("SEATWORKS_") or . == $hx.configDirEnv)))
              | (if $t.command then .command = $t.command else . end)
              | ($hx.provider.baseCredential.env // "") as $cred
              | if $cred != "" and .env[$cred] == "OAUTH_TOKEN" then del(.env[$cred]) else . end
            end)
    | (.daemon.agentProfiles // []) as $have
    | [$cfg.seats[]
        | . as $seat
        | $H[$seat.harness] as $hx
        | ($seat.models | if length > 0 then dflt else null end) as $d
        | { id: "\($s)-\($seat.role)", name: "\($n) · \($seat.label)", provider: "\($seat.role)-\($s)" }
          + (if $d then { model: $d.id }
             elif $m != "" then { model: $m }
             elif $hx.provider.defaultModel then { model: $hx.provider.defaultModel }
             else {} end)
          + (if $hx.provider.profileModeId then { modeId: $hx.provider.profileModeId } else {} end)
          + (($d.thinkingOptions // [] | dflt.id) as $t
             | if $t then { thinkingOptionId: $t }
               elif $seat.thinking then { thinkingOptionId: $seat.thinking }
               else {} end)
          + { notes: $seat.notes }] as $kitp
    | .daemon.agentProfiles = ($have | map(.id as $i
          | (($kitp | map(select(.id == $i)))[0].notes) as $kn
          | if $kn then .notes = $kn else . end))
        + ($kitp | map(select(.id as $i | $have | any(.id == $i) | not)))' $paseo_config >$new
        or not jq -e . $new >/dev/null 2>&1
    rm -f $new $manifests
    echo "! could not compose the providers and agent profiles in $paseo_config"
    exit 1
end
rm -f $manifests
set -l new_providers 0
if jq -e --slurpfile n $new '. == $n[0]' $paseo_config >/dev/null
    rm -f $new
else
    set -l bak $paseo_config.bak.(date +%Y%m%d-%H%M%S)
    cp $paseo_config $bak
    chmod 600 $bak $new
    set -l changes (jq -r --slurpfile o $paseo_config '
        ($o[0].agents.providers // {}) as $op | ($o[0].daemon.agentProfiles // []) as $oi
        | (.agents.providers | to_entries[] | select($op[.key] != .value)
            | "\(.key) \(if $op[.key] == null then "added" else "env updated" end)"),
          (.daemon.agentProfiles[] | select(.id as $i | $oi | any(.id == $i) | not) | "profile \(.name) added"),
          (.daemon.agentProfiles[] | . as $p | select($oi | any(.id == $p.id and .notes != $p.notes))
            | "profile \(.name) notes updated")' $new)
    mv $new $paseo_config
    for change in $changes
        string match -q 'profile *' -- $change; and continue
        string match -q '* added' -- $change; and set new_providers 1
    end
    echo "  ~ "(string join ', ' $changes)" (backup: $bak)"
end
for id in (jq -r '[.seats[].harness] | unique | .[]' $seats_file)
    set -l base (jq -r '.baseProvider' $harness_dir/$id/harness.json)
    set -l cred (jq -r '.provider.baseCredential.env // ""' $harness_dir/$id/harness.json)
    test -n "$cred"; or continue
    test (jq --arg b $base --arg v $cred '((.agents.providers[$b].env[$v]) // "") | length > 0' $paseo_config) = true
    or echo "  ! the base `$base` provider has no $cred, so its seats can't log in: set it there (SETUP.md, \"Add the base providers to Paseo\") and run paseo reload."
end

paseo project ls --json 2>/dev/null | jq -e --arg p $repo_dir 'any(.[]; .path == $p)' >/dev/null 2>&1
or begin
    paseo project create $repo_dir >/dev/null
    and echo "  ~ registered $repo_dir as a Paseo project"
end

fish $kit/setup/setup-seats.fish
set -l seats_status $status
paseo reload >/dev/null 2>&1; and echo "  ~ paseo reloaded"
test $new_providers -eq 1
and echo "  ! run `paseo daemon restart` before you start a seat: a reload lists a new provider but builds no snapshot for it, so create_agent reports it as unavailable."

echo ""
if test (count $added) -gt 0
    echo "Added to $repo_dir: "(string join ', ' $added)
else
    echo "Nothing new to copy: $repo_dir already has every template file."
end
if test (count $refreshed) -gt 0
    echo "Refreshed from the kit: "(string join ', ' $refreshed)
    echo "The previous copies are in "(string replace -- "$repo_dir/" '' $drafts)"/; running agents keep the old text until archived."
else if test $refresh -eq 1
    echo "Nothing to refresh: the seat prompts and skills already match the kit."
end
echo "Seats: "(for role in $roles
    echo -n "$role-$slug ("(jq -r --arg r $role '.seats[] | select(.role == $r) | .label' $seats_file)") "
end | string trim)
command -q ocr
or echo "! the Reviewer runs Open Code Review, which isn't installed: npm install -g @alibaba-group/open-code-review"
echo "Next: start $entry-$slug in this repository and ask it to run its workspace-protocol skill,"
echo "which fills in the UPPER_SNAKE_CASE placeholders in AGENTS.md and .seatworks/WORKSPACE_PROTOCOL.md."
exit $seats_status
