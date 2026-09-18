import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { sourceLabel } from "./bits.tsx";
import type { Catalog, Layer, RoleChoice, TeamView } from "./data.ts";
import { modelRow, setRole, sourceOf } from "./data.ts";
import { TabBar } from "./tabs.tsx";

type Props = {
  catalog: Catalog;
  team: TeamView;
  values: Layer;
  machine: Layer;
  layer: "machine" | "project";
  theme: PluginTheme;
  disabled: boolean;
  save(change: (values: Layer) => Layer): void;
};

export function TeamSection({ catalog, team, values, machine, layer, theme, disabled, save }: Props) {
  const [active, setActive] = useState(catalog.roles[0]?.id ?? "");
  const role = catalog.roles.find((entry) => entry.id === active) ?? catalog.roles[0];
  if (!role) return null;
  const seat = team.roles[role.id];
  const harness = catalog.harnesses.find((entry) => entry.id === seat?.harness);
  const models = harness?.models ?? [];
  const model = seat?.model ?? models[0]?.id ?? "";
  const row = modelRow(model, models);
  const stray = row.stray;
  const thinking = harness?.thinking === false ? [] : (models.find((entry) => entry.id === model)?.thinkingOptions ?? []);
  const source = (field: keyof RoleChoice) => sourceOf(values, machine, (entry) => entry.roles?.[role.id]?.[field], layer);

  return (
    <SettingsSection title="Team" info={role.description}>
      <TabBar theme={theme} active={role.id} disabled={disabled} onPick={setActive} tabs={catalog.roles.map((entry) => ({ id: entry.id, label: entry.label }))} />
      <SettingsCard>
        <SettingsSelect
          label="Agent"
          hint={sourceLabel(source("harness"), layer)}
          value={seat?.harness ?? role.defaults.harness}
          options={role.harnesses.map((id) => ({ label: catalog.harnesses.find((entry) => entry.id === id)?.label ?? id, value: id }))}
          onValueChange={(next) => save((current) => setRole(current, role.id, { harness: next }, true))}
          disabled={disabled}
        />
        {models.length > 1 || stray ? (
          <SettingsSelect
            label="Model"
            hint={stray ? `${model} is not one this agent offers. Pick one it does.` : sourceLabel(source("model"), layer)}
            value={row.value}
            options={row.options}
            onValueChange={(next) => save((current) => setRole(current, role.id, { model: next }))}
            disabled={disabled}
          />
        ) : models.length === 1 ? (
          <SettingsRow label="Model" hint={`${harness?.label ?? "This agent"} runs one model.`}>
            <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{models[0]!.label}</Text>
          </SettingsRow>
        ) : null}
        {thinking.length > 0 ? (
          <SettingsSelect
            label="Thinking"
            hint={sourceLabel(source("thinking"), layer)}
            value={seat?.thinking ?? thinking[0]!.id}
            options={thinking.map((entry) => ({ label: entry.label, value: entry.id }))}
            onValueChange={(next) => save((current) => setRole(current, role.id, { thinking: next }))}
            disabled={disabled}
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
