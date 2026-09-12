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

later="Log the event in .seatworks/records/attention/ and send it on the next sweep."
seats=${SEATWORKS_SEATS:-$SEATWORKS_KIT/seats.json}
want=$(jq -r '.seats[] | select(.entry == true) | .role' "$seats" 2>/dev/null)
[ -n "$want" ] || want=supervisor

id=$(field .tool_input.agentId)
[ -n "$id" ] || block "send_agent_prompt has no agentId; pass the ${want}'s full agent id."
command -v paseo >/dev/null 2>&1 || block "paseo is not on PATH, so this message's target can't be checked. $later"

list=$(paseo ls -g -a --json 2>/dev/null) ||
    block "paseo ls failed, so this message's target can't be checked. $later"

here=${SEATWORKS_REPO%/}
[ -n "$here" ] && case $here in "$HOME"/*) here="~${here#$HOME}" ;; esac
provider=$(jq -er --arg id "$id" --arg here "$here" '
    if type != "array" then error
    else first(.[] | select(.id == $id)
        | select($here == "" or .cwd == $here or (.cwd | startswith($here + "/")))
        | .provider) // "" end' <<<"$list" 2>/dev/null) ||
    block "paseo ls returned no agent list, so this message's target can't be checked. $later"

case ${provider%%/*} in
"$want") pass ;;
"") block "no agent with the id $id runs in this repository. Send attention events only to this project's $want, by its full agent id from paseo ls." ;;
esac
block "agent $id runs $provider. The watcher sends attention events only to this project's $want; log anything else in .seatworks/records/attention/."
