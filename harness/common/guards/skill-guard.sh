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

tool=$(field .tool_name)
transcript=$(field .transcript_path)

loaded() {
    local name=$1
    [ -r "$transcript" ] || return 1
    jq -r --arg n "$name" '
        (.message?.content? // empty) as $c
        | if ($c | type) == "array" then
              $c[]
              | select(.type == "tool_use")
              | if .name == "Skill" and (.input.skill? == $n) then "hit"
                elif (.name | IN("Read", "View")) and ((.input.file_path? // "") | test("/" + $n + "/SKILL\\.md$")) then "hit"
                elif .name == "Bash" and ((.input.command? // "") | test("/" + $n + "/SKILL\\.md")) then "hit"
                else empty end
          else empty end' "$transcript" 2>/dev/null | grep -q hit
}

gates() {
    jq -r --arg r "$role" --arg o "$1" \
        '.skillGates[]? | select(.seat == $r and .on == $o) | "\(.skill)\t\(.because)"' "$seats"
}

require() {
    local on=$1 what=$2 line skill why
    while IFS=$'\t' read -r skill why; do
        [ -n "$skill" ] || continue
        loaded "$skill" && continue
        block "$what without loading the \`$skill\` skill first, because $why. Load it with the Skill tool, then make this call again."
    done < <(gates "$on")
}

reviewer_target() {
    local spec key role config=${SEATWORKS_PASEO_CONFIG:-$HOME/.paseo/config.json}
    spec=$(field .tool_input.provider)
    key=${spec%%/*}
    [ -n "$key" ] || return 1
    if [ -r "$config" ]; then
        role=$(jq -r --arg k "$key" '.agents.providers[$k].env.SEATWORKS_ROLE // empty' "$config" 2>/dev/null)
    fi
    [ -n "$role" ] || role=${key%-*}
    jq -e --arg r "$role" 'any(.seats[]; .role == $r and .reviewSeat == true)' "$seats" >/dev/null 2>&1
}

merging() {
    local cmd
    cmd=$(field '.tool_input.command')
    printf '%s' "$cmd" | tr '\n' ' ' |
        grep -qE '(^|[;&|(]|&&)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(sudo[[:space:]]+|env[[:space:]]+|command[[:space:]]+)*([^[:space:]]*/)?git([[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+|--(git-dir|work-tree|exec-path|namespace)[[:space:]]+[^[:space:]]+|--?[^[:space:]]+))*[[:space:]]+(merge|cherry-pick)([[:space:]]|$)'
}

case $tool in
*create_agent)
    reviewer_target && require review "You can't brief a Reviewer"
    require delegate "You can't create a Peer"
    ;;
Edit | Write | MultiEdit | NotebookEdit)
    require write "You can't change a file"
    ;;
Bash)
    merging && require merge "You can't merge"
    ;;
esac

pass
