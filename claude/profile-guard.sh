#!/bin/bash

input=$(cat)
config=${SEATWORKS_PASEO_CONFIG:-$HOME/.paseo/config.json}
field() { jq -r "$1 // empty" <<<"$input"; }
block() {
    echo "Profile guard: $1" >&2
    exit 2
}

case $(field .tool_name) in
*update_agent)
    [ -n "$(field .tool_input.settings.model)" ] &&
        block "an agent keeps the model its profile gave it. To use another model, archive this agent and create one from the profile that has that model."
    [ -n "$(field .tool_input.settings.modeId)" ] &&
        block "an agent keeps the mode its profile gave it; change only thinkingOptionId."
    exit 0
    ;;
*create_agent) ;;
*) exit 0 ;;
esac

jq -e . "$config" >/dev/null 2>&1 || block "the Paseo config at $config can't be read, so this launch can't be checked against its profile."

spec=$(field .tool_input.provider)
provider=${spec%%/*}
model=
[ "$spec" != "$provider" ] && model=${spec#*/}
mode=$(field .tool_input.settings.modeId)
think=$(field .tool_input.settings.thinkingOptionId)

verdict=$(jq -r --arg p "$provider" --arg m "$model" --arg mode "$mode" --arg think "$think" '
    [.daemon.agentProfiles[]? | select(.provider == $p)] as $ps
    | [$ps[] | .model | select(. != null)] as $models
    | if ($ps | length) == 0 then "ok"
      elif ($models | length) > 0 and ($models | index($m) | not) then "model:" + $models[0]
      elif ($ps | any((.modeId // "") == $mode) | not) then "mode:" + ($ps[0].modeId // "")
      elif $think != "" and ($ps | all(.thinkingOptionId == null)) then "think:"
      else "ok" end' "$config")

case $verdict in
ok) exit 0 ;;
model:*)
    m=${verdict#model:}
    block "$provider runs $m, as its profile says. Pass provider \"$provider/$m\" (you passed \"$spec\"), copying the profile's modeId and thinkingOptionId into settings."
    ;;
mode:) block "$provider's profile sets no mode, so pass no settings.modeId (you passed \"$mode\")." ;;
mode:*) block "$provider's profile runs in mode ${verdict#mode:}: pass settings.modeId \"${verdict#mode:}\" (you passed \"$mode\")." ;;
think:) block "$provider's profile sets no thinking level, so pass no settings.thinkingOptionId." ;;
esac
exit 0
