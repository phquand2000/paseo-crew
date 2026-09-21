import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { sourceLabel } from "./bits.tsx";
import type { Catalog, Layer, RoleChoice, TeamView } from "./data.ts";
import { modelRow, setRole, sourceOf } from "./data.ts";
import { TabBar } from "./tabs.tsx";
import { WatcherSettings } from "./watch.tsx";

type Props = {
  catalog: Catalog;
  team: TeamView;
  values: Layer;
  machine: Layer;
  layer: "machine" | "project";
  theme: PluginTheme;
  disabled: boolean;
  /** The role whose chip is open; the Flow tab opens the Watcher's to add a key. */
  active: string | null;
  onActive(role: string): void;
  save(change: (values: Layer) => Layer): Promise<boolean>;
};

type Role = Catalog["roles"][number];

/**
 * A role's agent, model and thinking, as the rows of a card. Rows rather than a component, because
 * the card draws a border on each child it is given, and the Watcher's card puts its own rows around
 * these.
 */
export function roleRows({ catalog, team, values, machine, layer, theme, disabled, save, role }: Omit<Props, "active" | "onActive"> & { role: Role }): ReactElement[] {
  const seat = team.roles[role.id];
  const follows = role.follows ? catalog.roles.find((entry) => entry.id === role.follows)?.label : undefined;
  const harness = catalog.harnesses.find((entry) => entry.id === seat?.harness);
  const models = harness?.models ?? [];
  const model = seat?.model ?? models[0]?.id ?? "";
  const row = modelRow(model, models);
  const stray = row.stray;
  const thinking = harness?.thinking === false ? [] : (models.find((entry) => entry.id === model)?.thinkingOptions ?? []);
  const source = (field: keyof RoleChoice) => sourceOf(values, machine, (entry) => entry.roles?.[role.id]?.[field], layer);
  const rows: ReactElement[] = [
    <SettingsSelect
      key="agent"
      label="Agent"
      hint={sourceLabel(source("harness"), layer, follows)}
      value={seat?.harness ?? role.defaults.harness}
      options={role.harnesses.map((id) => ({ label: catalog.harnesses.find((entry) => entry.id === id)?.label ?? id, value: id }))}
      onValueChange={(next) => void save((current) => setRole(current, role.id, { harness: next }, true))}
      disabled={disabled}
    />,
  ];
  if (models.length > 1 || stray) {
    rows.push(
      <SettingsSelect
        key="model"
        label="Model"
        hint={stray ? `${model} is not one this agent offers. Pick one it does.` : sourceLabel(source("model"), layer, follows)}
        value={row.value}
        options={row.options}
        onValueChange={(next) => void save((current) => setRole(current, role.id, { model: next }))}
        disabled={disabled}
      />,
    );
  } else if (models.length === 1) {
    rows.push(
      <SettingsRow key="model" label="Model" hint={`${harness?.label ?? "This agent"} runs one model.`}>
        <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{models[0]!.label}</Text>
      </SettingsRow>,
    );
  }
  if (thinking.length > 0) {
    rows.push(
      <SettingsSelect
        key="thinking"
        label="Thinking"
        hint={sourceLabel(source("thinking"), layer, follows)}
        value={seat?.thinking ?? thinking[0]!.id}
        options={thinking.map((entry) => ({ label: entry.label, value: entry.id }))}
        onValueChange={(next) => void save((current) => setRole(current, role.id, { thinking: next }))}
        disabled={disabled}
      />,
    );
  }
  return rows;
}

export function TeamSection(props: Props) {
  const { catalog, theme, disabled, active, onActive } = props;
  const role = catalog.roles.find((entry) => entry.id === active) ?? catalog.roles[0];
  if (!role) return null;
  return (
    <SettingsSection title="Team" info={role.description}>
      <TabBar theme={theme} active={role.id} disabled={disabled} onPick={onActive} tabs={catalog.roles.map((entry) => ({ id: entry.id, label: entry.label }))} />
      {role.can.includes("watch") ? <WatcherSettings {...props} role={role} rows={roleRows({ ...props, role })} /> : <SettingsCard>{roleRows({ ...props, role })}</SettingsCard>}
    </SettingsSection>
  );
}
