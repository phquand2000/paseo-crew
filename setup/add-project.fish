#!/usr/bin/env fish

set -l kit (path resolve (path dirname (status filename))/..)
set -l paseo_config $HOME/.paseo/config.json

set -l repo_dir ""
set -l slug ""
set -l model zai/glm-5.3
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
    echo "usage: add-project.fish REPO_DIR [--slug SLUG] [--model PI_MODEL (default zai/glm-5.3)] [--refresh]"
    exit 2
end
set repo_dir (path resolve $repo_dir)
test -n "$slug"; or set slug (path basename $repo_dir)
set slug (string replace -ra '[^a-z0-9-]' '-' -- (string lower -- $slug))

command -q jq; or begin
    echo "! jq must be on PATH."
    exit 1
end
if not test -f $paseo_config; or not jq -e . $paseo_config >/dev/null 2>&1
    echo "! $paseo_config is missing or not valid JSON; finish SETUP.md steps 3 to 5 first."
    exit 1
end

set -l seat $repo_dir/.seatworks
set -l sup_key claude-supervisor-$slug
set -l lead_key claude-lead-$slug
set -l peer_key pi-peer-$slug
set -l watch_key claude-watcher-$slug
set -l review_key pi-reviewer-$slug
set -l added

set -l stage (mktemp -d)
cp -R $kit/project/. $stage/
awk '/^````md$/{f=1; next} /^````$/{f=0} f' $kit/examples/WORKSPACE_PROTOCOL.md >$stage/WORKSPACE_PROTOCOL.md
for file in $stage/LEAD.md $stage/WORKSPACE_PROTOCOL.md (find $stage/skills/lead -type f)
    perl -pi -e "s/\bpi-peer\b(?![-\w])/$peer_key/g; s/\bpi-reviewer\b(?![-\w])/$review_key/g" $file
end
test -n "$model"; and perl -pi -e "s|PEER_MODEL|$model|g" $stage/WORKSPACE_PROTOCOL.md
for file in $stage/SUPERVISOR.md (find $stage/skills/supervisor -type f -name '*.md')
    perl -pi -e "s/\b(claude-supervisor|claude-lead|claude-watcher|pi-peer|pi-reviewer)-SLUG\b/\$1-$slug/g" $file
end

set -l refreshed
set -l drafts $seat/records/drafts/refresh-(date +%Y%m%d-%H%M%S)
for src in (find $stage -type f ! -name .DS_Store ! -path '*/__pycache__/*')
    set -l rel (string replace -- "$stage/" '' $src)
    if test -e $seat/$rel
        test $refresh -eq 1; or continue
        string match -qr '^(SUPERVISOR|LEAD|PEER|REVIEWER|WATCHER)\.md$|^skills/' -- $rel; or continue
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
if not test -e $repo_dir/CLAUDE.md
    echo '@AGENTS.md' >$repo_dir/CLAUDE.md
    set -a added CLAUDE.md
end

set -l missing 0
for key in $sup_key $lead_key $watch_key $peer_key $review_key
    jq -e --arg k $key '.agents.providers[$k]' $paseo_config >/dev/null 2>&1; or set missing 1
end
if test $missing -eq 1
    set -l has_token (jq '(.agents.providers.claude.env.CLAUDE_CODE_OAUTH_TOKEN // "") | length > 0' $paseo_config)
    cp $paseo_config $paseo_config.bak
    chmod 600 $paseo_config.bak
    if jq --slurpfile ex $kit/examples/paseo-providers.json --arg h $HOME --arg s $slug \
            --arg r $repo_dir --arg kit $kit --argjson tok $has_token '
        ($ex[0] | del(._doc)
          | walk(if type == "string" then (gsub("HOME_DIR"; $h) | gsub("SLUG"; $s)) else . end)) as $e
        | def claude_seat: .env.SEATWORKS_REPO = $r
            | if $tok then .env |= del(.CLAUDE_CODE_OAUTH_TOKEN) else . end;
        .agents.providers["claude-supervisor-\($s)"] //= ($e["claude-supervisor-SLUG"]
            | claude_seat | .env.SEATWORKS_KIT = $kit)
        | .agents.providers["claude-lead-\($s)"] //= ($e["claude-lead-SLUG"] | claude_seat)
        | .agents.providers["claude-watcher-\($s)"] //= ($e["claude-watcher-SLUG"] | claude_seat)
        | .agents.providers["pi-peer-\($s)"] //= ($e["pi-peer-SLUG"] | .env.SEATWORKS_REPO = $r)
        | .agents.providers["pi-reviewer-\($s)"] //= ($e["pi-reviewer-SLUG"] | .env.SEATWORKS_REPO = $r)' \
            $paseo_config >$paseo_config.new
        and jq -e . $paseo_config.new >/dev/null
        chmod 600 $paseo_config.new
        mv $paseo_config.new $paseo_config
        echo "  ~ added the missing providers among $sup_key, $lead_key, $watch_key, $peer_key, $review_key (backup: $paseo_config.bak)"
    else
        rm -f $paseo_config.new
        echo "! could not add the providers to $paseo_config"
        exit 1
    end
    test "$has_token" = true
    or echo "  ! the base `claude` provider has no token: set CLAUDE_CODE_OAUTH_TOKEN on $lead_key or on `claude`."
end

set -l new_profiles (jq -nc --arg s $slug --arg m "$model" '
    ($s | ascii_upcase) as $n
    | [
        {id: "\($s)-supervisor", name: "\($n) · Supervisor", provider: "claude-supervisor-\($s)",
         model: "claude-opus-5", modeId: "bypassPermissions", thinkingOptionId: "high",
         notes: "Start here. Meets the Human, settles intent into an owner directive, creates the Lead, and watches coordination."},
        {id: "\($s)-lead", name: "\($n) · Lead", provider: "claude-lead-\($s)",
         model: "claude-opus-5", modeId: "bypassPermissions", thinkingOptionId: "medium",
         notes: "Owns this project: framing, breakdown, Peers, integration, acceptance. The Supervisor creates it; start one directly only for a small, settled task."},
        {id: "\($s)-watcher", name: "\($n) · Watcher", provider: "claude-watcher-\($s)",
         model: "claude-haiku-4-5", modeId: "bypassPermissions",
         notes: "The Supervisor starts one with each Lead: it sweeps Lead and Peer activity on a heartbeat and sends the Supervisor ATTENTION events. Haiku has no thinking levels: pass no thinkingOptionId."},
        ({id: "\($s)-peer", name: "\($n) · Peer", provider: "pi-peer-\($s)", thinkingOptionId: "medium",
          notes: "The only Peer profile for work: the Engineer, Architect, and Scout dispositions all use it, and the brief sets the role. Use thinkingOptionId high for an Architect or a new boundary, low for a Scout. Pi has no modes: pass no modeId."}
         + (if $m == "" then {} else {model: $m} end)),
        ({id: "\($s)-reviewer", name: "\($n) · Reviewer", provider: "pi-reviewer-\($s)", thinkingOptionId: "high",
          notes: "Every review of a change: sealed axes, sweep scouts, re-reviews, council Verifiers and Auditors. Read-only; runs Open Code Review. Use the review-orchestration axis brief, with Machine pass and Rulings to check. No modeId: Pi has no modes."}
         + (if $m == "" then {} else {model: $m} end))
      ]')
set -l missing_profiles (jq -c --argjson p "$new_profiles" '
    ((.daemon.agentProfiles // []) | map(.id)) as $have | $p | map(select(.id as $i | $have | index($i) | not))' $paseo_config)
if test "$missing_profiles" != '[]'
    cp $paseo_config $paseo_config.bak
    chmod 600 $paseo_config.bak
    if jq --argjson add "$missing_profiles" '.daemon.agentProfiles = ((.daemon.agentProfiles // []) + $add)' \
            $paseo_config >$paseo_config.new
        and jq -e . $paseo_config.new >/dev/null
        chmod 600 $paseo_config.new
        mv $paseo_config.new $paseo_config
        echo "  ~ added agent profiles: "(echo $missing_profiles | jq -r 'map(.name) | join(", ")')
    else
        rm -f $paseo_config.new
        echo "! could not add the agent profiles to $paseo_config"
        exit 1
    end
end

paseo project ls 2>/dev/null | string match -q -- "*$repo_dir*"
or begin
    paseo project create $repo_dir >/dev/null
    and echo "  ~ registered $repo_dir as a Paseo project"
end

fish $kit/setup/setup-seats.fish
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
    echo "Nothing to refresh: the seat prompts and skills already match the kit."
end
echo "Seats: $sup_key (Supervisor), $lead_key (Lead), $peer_key (Peer), $review_key (Reviewer), $watch_key (watcher)."
command -q ocr
or echo "! the Reviewer runs Open Code Review, which isn't installed: npm install -g @alibaba-group/open-code-review"
echo "Next: start $sup_key in this repository and ask it to run its workspace-protocol skill,"
echo "which fills in the UPPER_SNAKE_CASE placeholders in AGENTS.md and .seatworks/WORKSPACE_PROTOCOL.md."
exit $seats_status
