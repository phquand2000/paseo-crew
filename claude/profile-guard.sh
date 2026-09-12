#!/bin/bash

block() {
    echo "Profile guard: $1" >&2
    exit 2
}

command -v jq >/dev/null 2>&1 || block "jq is not on PATH, so this call can't be checked against the agent profiles; install jq or add its directory to the Paseo daemon's PATH."
input=$(cat)
config=${SEATWORKS_PASEO_CONFIG:-$HOME/.paseo/config.json}
field() { jq -r "$1 // empty" <<<"$input"; }
has() { jq -e "$1" <<<"$input" >/dev/null 2>&1; }
readable() { jq -e . "$config" >/dev/null 2>&1; }
specs() {
    readable || { echo "(the Paseo config at $config can't be read; call list_profiles)"; return; }
    jq -r '[.daemon.agentProfiles[]? | .provider + (if .model then "/" + .model else "" end)]
        | unique | map("\"" + . + "\"") | join(", ")' "$config"
}

case $(field .tool_name) in
*update_agent)
    has '.tool_input.settings | objects | has("model")' &&
        block "an agent keeps the model its profile gave it, so update_agent can't set or clear settings.model. For another model, archive this agent and call create_agent with one of these provider strings: $(specs)."
    has '.tool_input.settings | objects | has("modeId")' &&
        block "an agent keeps the mode its profile gave it, so update_agent can't set settings.modeId; change only thinkingOptionId."
    exit 0
    ;;
*set_agent_mode)
    block "an agent keeps the mode its profile gave it, so set_agent_mode is not available. For another mode, archive this agent and call create_agent with one of these provider strings: $(specs)."
    ;;
*send_agent_prompt)
    has '.tool_input | has("sessionMode")' &&
        block "an agent keeps the mode its profile gave it: send the prompt again without sessionMode."
    exit 0
    ;;
*update_schedule)
    has '.tool_input | has("provider") or has("model") or has("mode")' || exit 0
    block "a schedule keeps the provider, model, and mode it was created with, so update_schedule may change only its other fields. To run it on another profile, delete it and call create_schedule with one of these provider strings: $(specs)."
    ;;
*create_agent) kind=agent ;;
*create_schedule) kind=schedule ;;
*) exit 0 ;;
esac

readable || block "the Paseo config at $config can't be read, so this launch can't be checked against its profile."

spec=$(field .tool_input.provider)
provider=${spec%%/*}
model=
[ "$spec" != "$provider" ] && model=${spec#*/}
mode=$(field .tool_input.settings.modeId)
think=$(field .tool_input.settings.thinkingOptionId)

verdict=$(jq -r --arg p "$provider" --arg m "$model" --arg mode "$mode" --arg think "$think" --arg kind "$kind" '
    [.daemon.agentProfiles[]? | select(.provider == $p)] as $ps
    | [$ps[] | .model | select(. != null)] as $models
    | if $p == "" or ($ps | length) == 0 then "noprofile"
      elif ($models | length) > 0 and ($models | index($m) | not) then "model:" + $models[0]
      elif $kind == "schedule" then "ok"
      elif ($ps | any((.modeId // "") == $mode) | not) then "mode:" + ($ps[0].modeId // "")
      elif $think != "" and ($ps | all(.thinkingOptionId == null)) then "think:"
      else "ok" end' "$config")

case $verdict in
ok) exit 0 ;;
noprofile)
    [ -n "$spec" ] || block "pass provider explicitly, as one of these provider strings: $(specs)."
    block "\"$provider\" has no agent profile. Launch agents only from a profile in list_profiles: pass provider as one of $(specs)."
    ;;
model:*)
    m=${verdict#model:}
    [ "$kind" = schedule ] && block "$provider runs $m, as its profile says. Pass provider \"$provider/$m\" (you passed \"$spec\")."
    block "$provider runs $m, as its profile says. Pass provider \"$provider/$m\" (you passed \"$spec\"), copying the profile's modeId and thinkingOptionId into settings."
    ;;
mode:) block "$provider's profile sets no mode, so pass no settings.modeId (you passed \"$mode\")." ;;
mode:*) block "$provider's profile runs in mode ${verdict#mode:}: pass settings.modeId \"${verdict#mode:}\" (you passed \"$mode\")." ;;
think:) block "$provider's profile sets no thinking level, so pass no settings.thinkingOptionId." ;;
esac
exit 0
