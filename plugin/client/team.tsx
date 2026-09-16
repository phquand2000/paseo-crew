import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Facts, Revert, sourceLabel } from "./bits.tsx";
import type { Catalog, Layer, RoleChoice, TeamView } from "./data.ts";
import { clearRole, setRole, sourceOf } from "./data.ts";
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
  const thinking = harness?.thinking === false ? [] : (models.find((model) => model.id === seat?.model)?.thinkingOptions ?? []);
  const source = (field: keyof RoleChoice) => sourceOf(values, machine, (entry) => entry.roles?.[role.id]?.[field], layer);
  const revert = (field: keyof RoleChoice) =>
    source(field) === "here" ? <Revert theme={theme} disabled={disabled} onPress={() => save((current) => clearRole(current, role.id, field))} /> : null;

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
        >
          {revert("harness")}
        </SettingsSelect>
        {models.length > 1 ? (
          <SettingsSelect
            label="Model"
            hint={sourceLabel(source("model"), layer)}
            value={seat?.model ?? models[0]!.id}
            options={models.map((model) => ({ label: model.label, value: model.id }))}
            onValueChange={(next) => save((current) => setRole(current, role.id, { model: next }))}
            disabled={disabled}
          >
            {revert("model")}
          </SettingsSelect>
        ) : null}
        {thinking.length > 0 ? (
          <SettingsSelect
            label="Thinking"
            hint={sourceLabel(source("thinking"), layer)}
            value={seat?.thinking ?? thinking[0]!.id}
            options={thinking.map((entry) => ({ label: entry.label, value: entry.id }))}
            onValueChange={(next) => save((current) => setRole(current, role.id, { thinking: next }))}
            disabled={disabled}
          >
            {revert("thinking")}
          </SettingsSelect>
        ) : null}
        <Facts
          theme={theme}
          items={[
            ...(role.headless ? [] : [{ label: "Profile", value: seat?.provider ?? "none" }]),
            { label: "Servers", value: seat?.mcp.join(", ") || "none" },
            { label: "Skills", value: String(seat?.skills.length ?? 0) },
          ]}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
