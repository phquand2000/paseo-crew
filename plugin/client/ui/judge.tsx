import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsInput, type SettingsInputHandle, SettingsRow } from "@getpaseo/plugin/client/ui";
import { type ReactElement, type RefObject, useRef, useState } from "react";
import { Text } from "react-native";
import { KEPT, type Layer } from "../../shared/settings.ts";
import type { CatalogView, TeamView } from "../../shared/views.ts";
import { sourceLabel } from "./bits.tsx";
import { setAttention, sourceOf } from "../model/layer.ts";
import { withKey } from "../model/layer.ts";
import { TabBar } from "./tabs.tsx";

type Props = {
  catalog: CatalogView;
  team: TeamView;
  values: Layer;
  machine: Layer;
  layer: "machine" | "project";
  theme: PluginTheme;
  disabled: boolean;
  role: CatalogView["roles"][number];
  rows: ReactElement[];
  save(change: (values: Layer) => Layer): Promise<boolean>;
};

type Sensor = CatalogView["sensors"][number];

type Draft = { typed: string; setDraft(text: string): void; field: RefObject<SettingsInputHandle | null> };

/** Rows, not a component, since the card borders each child it gets: a sensor's key typed and saved, replaced or forgotten on the machine, or on a project's screen only whether there is one. */
function keyRows({ sensor, values, machine, layer, theme, disabled, save }: Omit<Props, "catalog" | "team" | "role" | "rows"> & { sensor: Sensor }, { typed, setDraft, field }: Draft): ReactElement[] {
  const kept = values.sensor?.[sensor.id]?.key === KEPT || machine.sensor?.[sensor.id]?.key === KEPT;
  const write = (key: string | null) => {
    void save((current) => withKey(current, sensor.id, key)).then((saved) => {
      // The typed key is the owner's only copy, so it is cleared only once saved.
      if (!saved) return;
      setDraft("");
      field.current?.replaceText("");
    });
  };
  const model = (
    <SettingsRow key="sensor" label="Sensor" hint={`From catalog/sensor. ${sensor.terms}`}>
      <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{sensor.model}</Text>
    </SettingsRow>
  );
  if (layer === "project") {
    return [
      <SettingsRow key="key" label={sensor.key} hint="Kept on this machine for every project. Add, replace or forget it under Machine defaults, on the Watcher.">
        <Text style={{ color: kept ? theme.colors.foreground : theme.colors.statusWarning, fontSize: 14 }}>{kept ? "set" : "not set"}</Text>
      </SettingsRow>,
      model,
    ];
  }
  return [
    <SettingsInput
      key="key"
      ref={field}
      label={sensor.key}
      hint={kept ? "Kept on this machine and never shown again. Type another to replace it." : `${sensor.label} asks nothing without one.`}
      secureTextEntry
      onChangeText={setDraft}
      disabled={disabled}
    />,
    <SettingsAction key="save" label={kept ? "Replace the key" : "Save the key"} hint="A key starts paid calls, one at each moment the watch asks about." actionLabel="Save key" onPress={() => write(typed)} disabled={disabled || typed.length === 0} />,
    ...(kept ? [<SettingsAction key="forget" label="Forget the key" hint={`${sensor.label} asks nothing more until there is a key again.`} actionLabel="Forget key" onPress={() => write(null)} disabled={disabled} />] : []),
    model,
  ];
}

/** On the chip of a role that can judge: who answers the watch's questions, then that sensor's key or this seat's agent. */
export function JudgeCard(props: Props) {
  const { catalog, team, values, machine, layer, theme, disabled, role, rows, save } = props;
  const [draft, setDraft] = useState("");
  const field = useRef<SettingsInputHandle>(null);
  const judge = team.attention.judge;
  const sensor = catalog.sensors.find((entry) => entry.id === judge);
  const options = [{ id: "off", label: "Off" }, ...catalog.sensors.map((entry) => ({ id: entry.id, label: entry.label })), ...catalog.roles.filter((entry) => entry.can.includes("judge")).map((entry) => ({ id: entry.id, label: `${entry.label} seat` }))];
  const note = judge === role.id
    ? `One ${role.label} per project, seated under the Supervisor when a case first needs it, and let go once no lane is open. It answers each case with judge, and nobody is sent what it says.`
    : `No ${role.label} is seated while ${sensor ? sensor.label : "nobody"} answers. What is set for the ${role.label} seat is kept for when it answers again.`;
  return (
    <>
      <SettingsCard>
        <SettingsRow label="Answered by" hint={`Who answers the watch's questions. They are all in shadow: each answer is kept in the project's assessments.log, and no seat is sent it. ${sourceLabel(sourceOf(values, machine, (entry) => entry.attention?.judge, layer), layer)}.`}>
          <TabBar theme={theme} active={judge} disabled={disabled} onPick={(next) => void save((current) => setAttention(current, { judge: next }))} tabs={options} />
        </SettingsRow>
        {judge === role.id ? rows : sensor ? keyRows({ ...props, sensor }, { typed: draft.trim(), setDraft, field }) : null}
      </SettingsCard>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{note}</Text>
    </>
  );
}
