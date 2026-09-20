import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsInput, type SettingsInputHandle, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useRef, useState } from "react";
import { Text } from "react-native";
import { KEPT } from "../shared/rpc.ts";
import { sourceLabel } from "./bits.tsx";
import type { Layer, TeamView } from "./data.ts";
import { setAttention, setSensorKey, sourceOf } from "./data.ts";

type Props = {
  team: TeamView;
  values: Layer;
  machine: Layer;
  layer: "machine" | "project";
  theme: PluginTheme;
  disabled: boolean;
  save(change: (values: Layer) => Layer): Promise<boolean>;
};

export function WatchSection({ team, values, machine, layer, theme, disabled, save }: Props) {
  const [draft, setDraft] = useState("");
  const field = useRef<SettingsInputHandle>(null);
  // The key itself never comes back from the server, so what a screen can know is only whether one is
  // set. It is kept on the machine, and the watch reads it for every project.
  const set = (layer === "machine" ? values : machine).sensor?.key === KEPT;
  const typed = draft.trim();
  const from = sourceLabel(sourceOf(values, machine, (entry) => entry.attention?.watch, layer), layer);

  const write = (key: string | null) => {
    void save((current) => setSensorKey(current, key)).then((saved) => {
      // The typed key is the owner's only copy of it, so it is left in the field when the save is
      // refused and cleared only once it is on disk.
      if (!saved) return;
      setDraft("");
      field.current?.replaceText("");
    });
  };

  return (
    <SettingsSection title="Watch" info="The desk follows what Leads and Peers do, and marks what looks wrong. The key is its switch: with one it runs, without one it does not run at all.">
      <SettingsCard>
        <SettingsSwitch
          label="Tell the Supervisor"
          hint={
            team.attention.watch
              ? `What the watch marks is mailed to the Supervisor, up to ${team.attention.incidentsPerDay} a day. ${from}`
              : `What the watch marks is recorded and listed, and none of it is mailed. ${from}`
          }
          value={team.attention.watch}
          onValueChange={(next) => void save((current) => setAttention(current, { watch: next }))}
          disabled={disabled}
        />
        {layer === "machine" ? (
          <>
            <SettingsInput
              ref={field}
              label="Sensor key"
              hint={set ? "A key is set, so the watch runs. It is never shown again; type another to replace it." : "An OpenRouter key. Without one there is no watch: no seat is followed and nothing is recorded."}
              placeholder="sk-or-…"
              secureTextEntry
              onChangeText={setDraft}
              disabled={disabled}
            />
            <SettingsAction
              label={set ? "Replace the key" : "Use this key"}
              hint="A key starts paid calls: one per watched seat five seconds after it falls quiet, at least one every thirty seconds while it works, and one at once whenever a turn ends or something goes wrong."
              actionLabel="Save"
              onPress={() => write(typed)}
              disabled={disabled || typed.length === 0}
            />
            {set ? <SettingsAction label="Forget the key" hint="The watch stops: the seats are let go on the next round, and nothing more is read or recorded." actionLabel="Forget" onPress={() => write(null)} disabled={disabled} /> : null}
          </>
        ) : (
          <SettingsRow label="Sensor key" hint={set ? "Set on this machine, so the watch runs on every project." : "Not set, so the watch does not run. Add one under Machine defaults to switch it on."}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>{set ? "set" : "none"}</Text>
          </SettingsRow>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
