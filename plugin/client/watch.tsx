import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsInput, type SettingsInputHandle, SettingsRow, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { type ReactElement, useRef, useState } from "react";
import { Text } from "react-native";
import { KEPT } from "../shared/rpc.ts";
import { sourceLabel } from "./bits.tsx";
import type { Catalog, Layer, TeamView } from "./data.ts";
import { setAttention, setSensorKey, sourceOf } from "./data.ts";
import { TabBar } from "./tabs.tsx";

type Props = {
  catalog: Catalog;
  team: TeamView;
  values: Layer;
  machine: Layer;
  layer: "machine" | "project";
  theme: PluginTheme;
  disabled: boolean;
  role: Catalog["roles"][number];
  /** The Watcher role's own agent, model and thinking, shown while the watch is by a seat. */
  rows: ReactElement[];
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

/**
 * The watch, on the Watcher's own chip and nowhere else: what reads the seats, then either the
 * Watcher seat's agent or Jev's key and sensor, then whether incidents are mailed.
 */
export function WatcherSettings({ catalog, team, values, machine, layer, theme, disabled, rows, save }: Props) {
  const [draft, setDraft] = useState("");
  const field = useRef<SettingsInputHandle>(null);
  const by = team.attention.by;
  // The key itself never comes back from the server, so what a screen can know is only whether one is
  // set. It is kept on the machine, and Jev reads it for every project.
  const set = (layer === "machine" ? values : machine).sensor?.key === KEPT;
  const typed = draft.trim();
  const mailFrom = CHOSEN[sourceOf(values, machine, (entry) => entry.attention?.watch, layer)][layer];
  const byFrom = sourceLabel(sourceOf(values, machine, (entry) => entry.attention?.by, layer), layer);

  const write = (key: string | null) => {
    void save((current) => setSensorKey(current, key)).then((saved) => {
      // The typed key is the owner's only copy of it, so it is left in the field when the save is
      // refused and cleared only once it is on disk.
      if (!saved) return;
      setDraft("");
      field.current?.replaceText("");
    });
  };

  const jev: ReactElement[] =
    layer === "machine"
      ? [
          <SettingsInput
            key="key"
            ref={field}
            label="OpenRouter key"
            hint={set ? "Kept on this machine and never shown again. Type another to replace it." : "Jev reads nothing without one, and the watch never falls back to a seat on its own."}
            placeholder="sk-or-…"
            secureTextEntry
            onChangeText={setDraft}
            disabled={disabled}
          />,
          <SettingsAction
            key="save"
            label={set ? "Replace the key" : "Save the key"}
            hint="A key starts paid calls: one per watched seat once it falls quiet, at least one every thirty seconds while it works, and one at once whenever a turn ends or something goes wrong."
            actionLabel="Save key"
            onPress={() => write(typed)}
            disabled={disabled || typed.length === 0}
          />,
          ...(set
            ? [<SettingsAction key="forget" label="Forget the key" hint="Jev stops reading on the next round, and nothing more is followed, read or recorded until there is a key again." actionLabel="Forget key" onPress={() => write(null)} disabled={disabled} />]
            : []),
        ]
      : [
          <SettingsRow key="key" label="OpenRouter key" hint="Kept on this machine and used by every project. Add or remove it under Machine defaults, on the Watcher.">
            <Text style={{ color: set ? theme.colors.foreground : theme.colors.statusWarning, fontSize: 14 }}>{set ? "set" : "not set"}</Text>
          </SettingsRow>,
        ];
  if (catalog.sensor) {
    jev.push(
      <SettingsRow key="sensor" label="Sensor" hint="From catalog/sensor · asked through OpenRouter">
        <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{catalog.sensor.model}</Text>
      </SettingsRow>,
    );
  }

  return (
    <>
      <SettingsCard>
        <SettingsRow label="Watch by" hint={byFrom}>
          <TabBar
            theme={theme}
            active={by}
            disabled={disabled}
            onPick={(next) => void save((current) => setAttention(current, { by: next as "seat" | "jev" }))}
            tabs={[
              { id: "seat", label: "Watcher seat" },
              { id: "jev", label: "Jev" },
            ]}
          />
        </SettingsRow>
        {by === "seat" ? rows : jev}
        <SettingsSwitch
          label="Mail incidents"
          hint={`To the Lead of the lane, or the Supervisor. Never to the seat it watched. ${mailFrom}`.trim()}
          value={team.attention.watch}
          onValueChange={(next) => void save((current) => setAttention(current, { watch: next }))}
          disabled={disabled}
        />
      </SettingsCard>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {by === "seat"
          ? "One Watcher per project, seated while a lane is open and let go when none is. It shows on the Flow tab beside the Supervisor, like any seat."
          : "No Watcher is seated while the watch is by Jev. What is set for the Watcher seat is kept for when it is by a seat again."}
      </Text>
    </>
  );
}
