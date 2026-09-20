import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsInput, type SettingsInputHandle, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useRef, useState } from "react";
import { Text } from "react-native";
import { KEPT } from "../shared/rpc.ts";
import type { Layer, TeamView } from "./data.ts";
import { setAttention, setSensorKey, sourceOf, watchState } from "./data.ts";

type Props = {
  team: TeamView;
  values: Layer;
  machine: Layer;
  layer: "machine" | "project";
  theme: PluginTheme;
  disabled: boolean;
  save(change: (values: Layer) => Layer): Promise<boolean>;
};

/**
 * Where the mail switch was chosen, said as a sentence.
 *
 * `sourceLabel` is a bare noun phrase, which reads correctly as a whole hint the way the Team and MCP
 * tabs use it. Appended after a statement it read as a second claim about the setting's state — "none
 * of it is mailed. Set for this project" — so this row says it with a verb instead.
 */
const CHOSEN = {
  here: { machine: "Chosen here, for every project that sets nothing.", project: "This project chose it." },
  machine: { machine: "", project: "Not chosen here; following this machine." },
  default: { machine: "Not chosen anywhere; the catalog's default.", project: "Not chosen anywhere; the catalog's default." },
} as const;

export function WatchSection({ team, values, machine, layer, theme, disabled, save }: Props) {
  const [draft, setDraft] = useState("");
  const field = useRef<SettingsInputHandle>(null);
  // The key itself never comes back from the server, so what a screen can know is only whether one is
  // set. It is kept on the machine, and the watch reads it for every project.
  const set = (layer === "machine" ? values : machine).sensor?.key === KEPT;
  const typed = draft.trim();
  const from = CHOSEN[sourceOf(values, machine, (entry) => entry.attention?.watch, layer)][layer];
  const state = watchState(set, team.attention.watch, team.attention.incidentsPerDay, layer, from);

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
    <SettingsSection
      title="Watch"
      info="The desk can follow what Leads and Peers do while they work, read their turns, and mark what looks wrong. It puts each turn to a sensor — a model outside the seat — for a second opinion, and that sensor's key is the watch's only switch: with one it runs, with none it does not run at all."
    >
      <SettingsCard>
        <SettingsRow label={state.title} hint={state.hint} />
        {layer === "machine" ? (
          <>
            <SettingsInput ref={field} label="Sensor key" hint={state.keyHint} placeholder="sk-or-…" secureTextEntry onChangeText={setDraft} disabled={disabled} />
            <SettingsAction
              label={set ? "Replace the key" : "Switch the watch on"}
              hint="A key starts paid calls: one per watched seat five seconds after it falls quiet, at least one every thirty seconds while it works, and one at once whenever a turn ends or something goes wrong."
              actionLabel="Save key"
              onPress={() => write(typed)}
              disabled={disabled || typed.length === 0}
            />
            {set ? (
              <SettingsAction
                label="Switch the watch off"
                hint="Forgets the key. The seats are let go on the next round, and nothing more is followed, read or recorded."
                actionLabel="Forget key"
                onPress={() => write(null)}
                disabled={disabled}
              />
            ) : null}
          </>
        ) : (
          <SettingsRow label="Sensor key" hint="Kept on this machine and used by every project. Add or remove it under Machine defaults · Team · Watch.">
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>{set ? "set" : "none"}</Text>
          </SettingsRow>
        )}
      </SettingsCard>

      <SettingsCard>
        <SettingsSwitch
          label="Mail incidents to the Supervisor"
          hint={state.mailHint}
          value={team.attention.watch}
          onValueChange={(next) => void save((current) => setAttention(current, { watch: next }))}
          disabled={disabled}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
