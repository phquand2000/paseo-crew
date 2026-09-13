#!/usr/bin/env fish

set -l kit (path resolve (path dirname (status filename))/..)
set -l paseo_config (test -n "$SEATWORKS_PASEO_CONFIG"; and echo $SEATWORKS_PASEO_CONFIG; or echo $HOME/.paseo/config.json)
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
    echo "usage: add-project.fish REPO_DIR [--slug SLUG] [--model MODEL (pins this project's model for the roles whose seats.json entry names none)] [--refresh]"
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
    echo "! $repo_dir is not a git repository, and every seat commits its work there; run git init there first."
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

for id in (jq -r '[.seats[].harness] | unique | .[]' $seats_file)
    set -l root (string replace -r '^HOME' $HOME (jq -r '.profileRoot' $harness_dir/$id/harness.json))
    set -l prompt_file (jq -r '.promptFile' $harness_dir/$id/harness.json)
    for role in $roles
        set -l link $root/$role-$slug/$prompt_file
        test -L $link; or continue
        set -l other (string replace -r '/\.seatworks/.*$' '' -- (readlink $link))
        test "$other" = "$repo_dir"; and continue
        echo "! the slug $slug already belongs to $other: pass --slug with another name."
        exit 1
    end
end

set -l seat $repo_dir/.seatworks
set -l added

set -l stage (mktemp -d)
cp -R $kit/project/. $stage/
awk '/^````md$/{f=1; next} /^````$/{f=0} f' $kit/examples/WORKSPACE_PROTOCOL.md >$stage/guides/WORKSPACE_PROTOCOL.md

set -l refreshed
set -l drafts $seat/records/drafts/refresh-(date +%Y%m%d-%H%M%S)

for flat in SUPERVISOR.md LEAD.md PEER.md REVIEWER.md WATCHER.md BRIEF.md DIRECTIVE.md FEATURE_INTAKE.md PLANS.md WORKSPACE_PROTOCOL.md NOTEBOOK.md
    test -f $seat/$flat; or continue
    set -l now (find $stage -type f -name $flat | head -1)
    test -n "$now"; or continue
    set -l dest (string replace -- "$stage/" '' $now)
    mkdir -p (path dirname $drafts/$flat)
    if test -e $seat/$dest
        mv $seat/$flat $drafts/$flat
        set -a refreshed ".seatworks/$flat (moved to records/drafts; it lives at $dest now)"
    else
        mkdir -p (path dirname $seat/$dest)
        mv $seat/$flat $seat/$dest
        set -a refreshed ".seatworks/$flat -> .seatworks/$dest"
    end
end

for src in (find $stage -type f ! -name .DS_Store ! -path '*/__pycache__/*')
    set -l rel (string replace -- "$stage/" '' $src)
    if test -e $seat/$rel
        test $refresh -eq 1; or continue
        set -l replaceable 0
        if test $rel = guides/WORKSPACE_PROTOCOL.md
            grep -qE 'STRICTNESS_LEVEL|REVIEW_RULE' $seat/$rel; and set replaceable 1
        else if contains -- $rel $prompts
            set replaceable 1
        else if string match -q 'skills/*' -- $rel; or string match -q 'guides/*' -- $rel
            set replaceable 1
        end
        test $replaceable -eq 1; or continue
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
if test $refresh -eq 1
    for owned in skills prompts guides
        test -d $seat/$owned; or continue
        for old in (find $seat/$owned -type f ! -name .DS_Store ! -path '*/__pycache__/*')
            set -l rel (string replace -- "$seat/" '' $old)
            test -e $stage/$rel; and continue
            test $rel = guides/WORKSPACE_PROTOCOL.md; and continue
            mkdir -p (path dirname $drafts/$rel)
            mv $old $drafts/$rel
            set -a refreshed ".seatworks/$rel (retired)"
        end
        find $seat/$owned -type d -empty -delete
    end
end
rm -rf $stage

set -l project $seat/project.json
set -l models '{}'
if test -n "$model"
    set models (jq -c --slurpfile s $seats_file --arg m $model '
        reduce ($s[0].seats[] | select((.models | length) == 0) | .role) as $r ({}; .[$r] = $m)' -n)
end
set -l new_project (jq -n --arg s $slug --argjson m "$models" '{slug: $s} + (if $m == {} then {} else {models: $m} end)')
if not test -f $project
    echo $new_project | jq . >$project
    set -a added .seatworks/project.json
else if not jq -e --argjson n "$new_project" '.slug == $n.slug' $project >/dev/null 2>&1
    echo "  ! $project names another slug; leaving it alone. Delete it and rerun to change the slug."
else if test -n "$model"
    jq --argjson m "$models" '.models = ((.models // {}) + $m)' $project >$project.new
    and mv $project.new $project
    and echo "  ~ .seatworks/project.json: pinned $model for this project"
end

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

fish $kit/setup/setup-seats.fish --project $repo_dir
set -l seats_status $status
paseo reload >/dev/null 2>&1; and echo "  ~ paseo reloaded"

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
    echo "Nothing to refresh: the prompts, guides and skills already match the kit."
end
echo "Seats for $slug: "(for role in $roles
    echo -n "$role ("(jq -r --arg r $role '.seats[] | select(.role == $r) | .label' $seats_file)") "
end | string trim)
command -q ocr
or echo "  · every review starts from Open Code Review, which isn't installed: npm install -g @alibaba-group/open-code-review. It needs no key; without it the Reviewer scopes from git show --stat and says so."
echo "Next: fill in the UPPER_SNAKE_CASE placeholders in AGENTS.md and"
echo ".seatworks/guides/WORKSPACE_PROTOCOL.md, or delete a line there to keep the Lead's default."
echo "Then start the $entry profile in this repository."
exit $seats_status
