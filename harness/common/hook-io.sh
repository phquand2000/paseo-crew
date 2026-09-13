prefix=${SEATWORKS_GUARD_LABEL:-Seat guard}

block() {
    echo "$prefix: $*" >&2
    exit 2
}

pass() {
    exit 0
}

note() {
    jq -nc --arg e "$1" --arg c "$2" '{hookSpecificOutput: {hookEventName: $e, additionalContext: $c}}'
    exit 0
}

need_jq() {
    command -v jq >/dev/null 2>&1 ||
        block "jq is not on PATH, so this call can't be checked; install jq or add its directory to the agent daemon's PATH."
}

read_hook_input() {
    input=$(cat)
}

field() {
    jq -r "$1 // empty" <<<"$input"
}

has() {
    jq -e "$1" <<<"$input" >/dev/null 2>&1
}
