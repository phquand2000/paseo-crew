#!/usr/bin/env fish
#
# add-project: give one repository its own Lead and Peer seats.
#
#   fish setup/add-project.fish REPO_DIR [--slug SLUG] [--model PI_MODEL] [--refresh]
#
# 1. Copies the kit's project templates into REPO_DIR/.seatworks/: SUPERVISOR.md, LEAD.md,
#    PEER.md, REVIEWER.md, WATCHER.md, NOTEBOOK.md, WORKSPACE_PROTOCOL.md, and skills/ for each
#    role.
# 2. Adds AGENTS.md and a one-line CLAUDE.md (@AGENTS.md) at the repository root when they are
#    missing.
# 3. Adds the providers claude-supervisor-SLUG, claude-lead-SLUG, claude-watcher-SLUG,
#    pi-peer-SLUG, and pi-reviewer-SLUG to ~/.paseo/config.json, and one Paseo agent profile
#    for each seat.
# 4. Registers the repository as a Paseo project, runs setup-seats.fish, and reloads Paseo.
#
# It never overwrites an existing file, so rerunning it only fills gaps. Edit the project's
# copies to give that project its own rules. SLUG defaults to the repository's directory name
# in lowercase. PI_MODEL is the Peer model written into the spawn recipe, such as zai/glm-5.3.
#
# --refresh carries kit template changes into a project that already has its files: it
# replaces the seat prompts (SUPERVISOR.md, LEAD.md, PEER.md, REVIEWER.md, WATCHER.md) and the skills with
# the kit's current versions and moves skill files the kit no longer ships out of the way,
# keeping each copy under .seatworks/records/drafts/refresh-STAMP/.
# NOTEBOOK.md and WORKSPACE_PROTOCOL.md hold the project's own content and are never replaced.

set -l kit (path resolve (path dirname (status filename))/..)
set -l paseo_config $HOME/.paseo/config.json

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
    echo "usage: add-project.fish REPO_DIR [--slug SLUG] [--model PI_MODEL] [--refresh]"
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

# ── 1. Templates ────────────────────────────────────────────────────────────────────
# Build the copies in a staging directory, name this project's Peer provider in the Lead's
# files, then copy only what the project doesn't have yet.

set -l stage (mktemp -d)
cp -R $kit/project/. $stage/
awk '/^````md$/{f=1; next} /^````$/{f=0} f' $kit/examples/WORKSPACE_PROTOCOL.md >$stage/WORKSPACE_PROTOCOL.md
for file in $stage/LEAD.md $stage/WORKSPACE_PROTOCOL.md (find $stage/skills/lead -type f)
    perl -pi -e "s/\bpi-peer\b(?![-\w])/$peer_key/g; s/\bpi-reviewer\b(?![-\w])/$review_key/g" $file
end
test -n "$model"; and perl -pi -e "s|PEER_MODEL|$model|g" $stage/WORKSPACE_PROTOCOL.md
# The Supervisor's files name the seats as PROVIDER-SLUG; other SLUG placeholders in them
# (a directive's file name, for example) stay for the Supervisor to fill in.
for file in $stage/SUPERVISOR.md (find $stage/skills/supervisor -type f -name '*.md')
    perl -pi -e "s/\b(claude-supervisor|claude-lead|claude-watcher|pi-peer|pi-reviewer)-SLUG\b/\$1-$slug/g" $file
end

set -l refreshed
set -l drafts $seat/records/drafts/refresh-(date +%Y%m%d-%H%M%S)
for src in (find $stage -type f ! -name .DS_Store ! -path '*/__pycache__/*')
    set -l rel (string replace -- "$stage/" '' $src)
    if test -e $seat/$rel
        # Only --refresh touches an existing file, and only a kit-owned one: the seat prompts
        # and the skills. The notebook and the protocol hold the project's own content.
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
# A skill file the kit no longer ships would linger and contradict the new text, so --refresh
# moves it to the drafts copy too.
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

# A project may have added its own ignore lines, so add only the kit's missing ones.
for line in (grep -v '^#' $kit/project/.gitignore)
    test -n "$line"; or continue
    grep -qxF -- $line $seat/.gitignore; and continue
    echo $line >>$seat/.gitignore
    set -a added ".seatworks/.gitignore ($line)"
end

# ── 2. Instruction files every agent reads ──────────────────────────────────────────
# Pi reads AGENTS.md and Claude Code reads CLAUDE.md, so CLAUDE.md imports AGENTS.md.

if not test -e $repo_dir/AGENTS.md
    awk '/^````md$/{f=1; next} /^````$/{f=0} f' $kit/examples/AGENTS_MD_SNIPPET.md >$repo_dir/AGENTS.md
    set -a added AGENTS.md
end
if not test -e $repo_dir/CLAUDE.md
    echo '@AGENTS.md' >$repo_dir/CLAUDE.md
    set -a added CLAUDE.md
end

# ── 3. Providers ────────────────────────────────────────────────────────────────────
# The entries come from the SLUG templates in examples/paseo-providers.json. The Lead entry
# carries no OAuth token when the base `claude` provider has one: it inherits it through
# `extends`.

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

# Agent profiles: named launch bundles that Paseo's app offers to the Human and that
# orchestrating agents read through list_profiles. There is exactly one Peer profile: the
# brief's disposition sets the Peer's role, not a separate profile. Existing profiles with the
# same ID are left as they are, so edited notes survive a rerun.
set -l new_profiles (jq -nc --arg s $slug --arg m "$model" '
    ($s | ascii_upcase) as $n
    | [
        {id: "\($s)-supervisor", name: "\($n) · Supervisor", provider: "claude-supervisor-\($s)",
         modeId: "bypassPermissions", thinkingOptionId: "medium",
         notes: "Start here. Meets the Human, settles intent into an owner directive, creates the Lead, and watches coordination."},
        {id: "\($s)-lead", name: "\($n) · Lead", provider: "claude-lead-\($s)",
         modeId: "bypassPermissions", thinkingOptionId: "medium",
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

# ── 4. Paseo project, profiles, reload ──────────────────────────────────────────────

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
if test -z "$model"
    echo "! no --model given: replace PEER_MODEL in .seatworks/WORKSPACE_PROTOCOL.md with one of:"
    paseo provider models $peer_key 2>/dev/null | awk 'NR > 1 { print "    " $1 }' | head -8
end
exit $seats_status
