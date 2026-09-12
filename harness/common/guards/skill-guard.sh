#!/bin/bash

role=${1:-${SEATWORKS_ROLE:-lead}}
export SEATWORKS_GUARD_LABEL="Skill guard"
hook_io=${SEATWORKS_HOOK_IO:-${SEATWORKS_KIT:+$SEATWORKS_KIT/harness/common/hook-io.sh}}
if [ -n "$hook_io" ] && [ -r "$hook_io" ]; then
    . "$hook_io"
else
    echo "Skill guard: harness/common/hook-io.sh is unreadable; set env.SEATWORKS_KIT on this seat's provider and rerun setup/setup-seats.fish." >&2
    exit 2
fi

need_jq
read_hook_input
seats=${SEATWORKS_SEATS:-$SEATWORKS_KIT/seats.json}
[ -r "$seats" ] || block "$seats can't be read, so the gates for this seat are unknown; set env.SEATWORKS_KIT on this seat's provider and rerun setup/setup-seats.fish."

harness=$(jq -r --arg r "$role" '.seats[] | select(.role == $r) | .harness' "$seats" 2>/dev/null)
manifest=$SEATWORKS_KIT/harness/$harness/harness.json
how=$(jq -r '.skillLoad.phrase // empty' "$manifest" 2>/dev/null)
[ -n "$how" ] || how="the way your harness loads a skill"
pattern=$(jq -r '.skillLoad.transcriptMatch // empty' "$manifest" 2>/dev/null)

tool=$(field .tool_name)
transcript=$(field .transcript_path)

loaded() {
    [ -r "$transcript" ] || return 1
    grep -qF -- "/$1/SKILL.md" "$transcript" && return 0
    [ -n "$pattern" ] || return 1
    grep -qF -- "${pattern//NAME/$1}" "$transcript"
}

require() {
    local on=$1 what=$2 skill why
    while IFS=$'\t' read -r skill why; do
        [ -n "$skill" ] || continue
        loaded "$skill" && continue
        block "$what without loading the \`$skill\` skill first, because $why. Load it with $how, then make this call again."
    done < <(jq -r --arg r "$role" --arg o "$on" \
        '.skillGates[]? | select(.seat == $r and .on == $o) | "\(.skill)\t\(.because)"' "$seats")
}

reviewer_target() {
    local key
    key=$(field .tool_input.provider)
    key=${key%%/*}
    [ -n "$key" ] || return 1
    jq -e --arg r "$key" 'any(.seats[]; .role == $r and .reviewSeat == true)' "$seats" >/dev/null 2>&1
}

merging() {
    printf '%s' "$(field '.tool_input.command')" | tr '\n' ' ' |
        grep -qE '(^|[;&|(]|&&)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(sudo[[:space:]]+|env[[:space:]]+|command[[:space:]]+)*([^[:space:]]*/)?git([[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+|--(git-dir|work-tree|exec-path|namespace)[[:space:]]+[^[:space:]]+|--?[^[:space:]]+))*[[:space:]]+(merge|cherry-pick)([[:space:]]|$)'
}

names() { jq -r --arg p "$1" "${2}[\$p][]? // empty" "$manifest" 2>/dev/null; }
is_one_of() {
    local want
    for want in $(names "$1" "$2"); do
        [ "$tool" = "$want" ] && return 0
    done
    return 1
}

case $tool in
*create_agent)
    reviewer_target && require review "You can't brief a Reviewer"
    require delegate "You can't create a Peer"
    ;;
esac
is_one_of file-edit .deny.intents && require write "You can't change a file"
[ "$tool" = "$(jq -r '.guards.shellTool // empty' "$manifest" 2>/dev/null)" ] && merging && require merge "You can't merge"

pass
