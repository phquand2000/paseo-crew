#!/bin/bash

export SEATWORKS_GUARD_LABEL="Watcher guard"
hook_io=${SEATWORKS_HOOK_IO:-${SEATWORKS_KIT:+$SEATWORKS_KIT/harness/common/hook-io.sh}}
if [ -n "$hook_io" ] && [ -r "$hook_io" ]; then
    . "$hook_io"
else
    echo "Watcher guard: harness/common/hook-io.sh is unreadable; set env.SEATWORKS_KIT on this seat's provider and rerun setup/setup-seats.fish." >&2
    exit 2
fi

need_jq
read_hook_input
case $(field .tool_name) in *send_agent_prompt) ;; *) pass ;; esac
id=$(field .tool_input.agentId)
[ -n "$id" ] || block "send_agent_prompt has no agentId; pass the Supervisor's full agent id."
command -v paseo >/dev/null 2>&1 || block "paseo is not on PATH, so this message's target can't be checked. Log the event in .seatworks/records/attention/ and send it on the next sweep."
list=$(paseo ls -g -a --json 2>/dev/null) || block "paseo ls failed, so this message's target can't be checked. Log the event in .seatworks/records/attention/ and send it on the next sweep."
provider=$(jq -er --arg id "$id" 'if type == "array" then (first(.[] | select(.id == $id) | .provider) // "") else error end' <<<"$list" 2>/dev/null) ||
    block "paseo ls returned no agent list, so this message's target can't be checked. Log the event in .seatworks/records/attention/ and send it on the next sweep."
slug=$SEATWORKS_SLUG
if [ -z "$slug" ]; then
    seat=${SEATWORKS_SEAT:-${CLAUDE_CONFIG_DIR##*/}}
    case $seat in watcher-?*) slug=${seat#watcher-} ;; esac
fi
if [ -n "$slug" ]; then
    want=supervisor-$slug
else
    want='supervisor-*'
fi
case ${provider%%/*} in
$want) pass ;;
"") block "no agent has the id $id. Send ATTENTION events only to this project's Supervisor, by its full agent id from paseo ls." ;;
esac
block "agent $id runs $provider. The watcher sends ATTENTION events only to this project's Supervisor (a $want agent); log anything else in .seatworks/records/attention/."
