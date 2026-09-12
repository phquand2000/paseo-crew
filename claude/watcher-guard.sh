#!/bin/bash

block() {
    echo "Watcher guard: $1" >&2
    exit 2
}

command -v jq >/dev/null 2>&1 || block "jq is not on PATH, so this message's target can't be checked; install jq or add its directory to the Paseo daemon's PATH."
input=$(cat)
case $(jq -r '.tool_name // empty' <<<"$input") in *send_agent_prompt) ;; *) exit 0 ;; esac
id=$(jq -r '.tool_input.agentId // empty' <<<"$input")
[ -n "$id" ] || block "send_agent_prompt has no agentId; pass the Supervisor's full agent id."
command -v paseo >/dev/null 2>&1 || block "paseo is not on PATH, so this message's target can't be checked. Log the event in .seatworks/records/attention/ and send it on the next sweep."
list=$(paseo ls -g -a --json 2>/dev/null) || block "paseo ls failed, so this message's target can't be checked. Log the event in .seatworks/records/attention/ and send it on the next sweep."
provider=$(jq -er --arg id "$id" 'if type == "array" then (first(.[] | select(.id == $id) | .provider) // "") else error end' <<<"$list" 2>/dev/null) ||
    block "paseo ls returned no agent list, so this message's target can't be checked. Log the event in .seatworks/records/attention/ and send it on the next sweep."
seat=${CLAUDE_CONFIG_DIR##*/}
case $seat in
claude-watcher-?*) want=claude-supervisor-${seat#claude-watcher-} ;;
*) want='claude-supervisor-*' ;;
esac
case ${provider%%/*} in
$want) exit 0 ;;
"") block "no agent has the id $id. Send ATTENTION events only to this project's Supervisor, by its full agent id from paseo ls." ;;
esac
block "agent $id runs $provider. The watcher sends ATTENTION events only to this project's Supervisor (a $want agent); log anything else in .seatworks/records/attention/."
