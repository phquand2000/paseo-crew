protocol=${SEATWORKS_HOOK_PROTOCOL:-exit-code}
prefix=${SEATWORKS_GUARD_LABEL:-Seat guard}

block() {
    case $protocol in
    json-decision)
        if command -v jq >/dev/null 2>&1; then
            jq -nc --arg r "$prefix: $*" '{permissionDecision: "deny", permissionDecisionReason: $r}'
        else
            printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' "$prefix: blocked, and jq is missing so the reason cannot be quoted safely"
        fi
        exit 0
        ;;
    *)
        echo "$prefix: $*" >&2
        exit 2
        ;;
    esac
}

pass() {
    case $protocol in
    json-decision) echo '{}' ;;
    esac
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
