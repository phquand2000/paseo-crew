#!/bin/bash

export SEATWORKS_GUARD_LABEL="Profile guard"
hook_io=${SEATWORKS_HOOK_IO:-${SEATWORKS_KIT:+$SEATWORKS_KIT/harness/common/hook-io.sh}}
if [ -n "$hook_io" ] && [ -r "$hook_io" ]; then
    . "$hook_io"
else
    echo "Profile guard: harness/common/hook-io.sh is unreadable; set env.SEATWORKS_KIT on this seat's provider and rerun setup/setup-seats.fish." >&2
    exit 2
fi

need_jq
read_hook_input
config=${SEATWORKS_PASEO_CONFIG:-$HOME/.paseo/config.json}
repo=${SEATWORKS_REPO%/}

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
    pass
    ;;
*set_agent_mode)
    block "an agent keeps the mode its profile gave it, so set_agent_mode is not available. For another mode, archive this agent and call create_agent with one of these provider strings: $(specs)."
    ;;
*send_agent_prompt)
    has '.tool_input | has("sessionMode")' &&
        block "an agent keeps the mode its profile gave it: send the prompt again without sessionMode."
    pass
    ;;
*update_schedule)
    has '.tool_input | has("provider") or has("model") or has("mode")' || pass
    block "a schedule keeps the provider, model, and mode it was created with, so update_schedule may change only its other fields. To run it on another profile, delete it and call create_schedule with one of these provider strings: $(specs)."
    ;;
*create_agent) kind=agent ;;
*create_schedule) kind=schedule ;;
*) pass ;;
esac

readable || block "the Paseo config at $config can't be read, so this launch can't be checked against its profile."

seats=${SEATWORKS_SEATS:-$SEATWORKS_KIT/seats.json}
role=${SEATWORKS_ROLE:-}
if [ -r "$seats" ] && [ -n "$role" ]; then
    target=$(field .tool_input.provider)
    target=${target%%/*}
    allowed=$(jq -r --arg r "$role" '[.seats[] | select(.role == $r) | (.mayStart // [])[]] | join(" ")' "$seats")
    case " $allowed " in
    *" $target "*) ;;
    *)
        [ -n "$allowed" ] || block "this seat starts no agents of its own; report what you need instead."
        block "a $role seat starts only ${allowed// /, }, and \"$target\" is none of them. seats.json's mayStart says which roles each seat may launch."
        ;;
    esac
fi

if [ -n "$repo" ]; then
    for key in .tool_input.cwd .tool_input.workspace.cwd; do
        where=$(field "$key")
        [ -n "$where" ] || continue
        case ${where%/}/ in
        "$repo"/*) ;;
        *) block "$where is outside $repo, and a seat there would load that project's prompts, skills, and guards. Leave the workspace out to use your own, or name one inside this repository." ;;
        esac
    done
fi

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
ok) pass ;;
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
pass
