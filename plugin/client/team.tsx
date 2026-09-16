import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import type { Catalog, Layer, RoleChoice, TeamView } from "./data.ts";
import { clearRole, setRole, sourceOf, sourceText } from "./data.ts";
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

const option = (id: string, label: string) => ({ label, value: id });

export function TeamSection({ catalog, team, values, machine, layer, theme, disabled, save }: Props) {
  const [active, setActive] = useState(catalog.roles[0]?.id ?? "");
  const role = catalog.roles.find((entry) => entry.id === active) ?? catalog.roles[0];
  if (!role) return null;
  const seat = team.roles[role.id];
  const harness = catalog.harnesses.find((entry) => entry.id === seat?.harness);
  const models = harness?.models ?? [];
  const thinking = harness?.thinking === false ? [] : (models.find((model) => model.id === seat?.model)?.thinkingOptions ?? []);
  const source = (field: keyof RoleChoice) => sourceOf(values, machine, (entry) => entry.roles?.[role.id]?.[field], layer);
  const hint = (field: keyof RoleChoice) => sourceText(source(field), layer);
  const reset = (field: keyof RoleChoice, label: string) =>
    source(field) === "here" ? (
      <SettingsAction
        label={`${label} is set here`}
        hint={layer === "machine" ? "Clearing it goes back to the catalog default." : "Clearing it follows the machine layer again."}
        actionLabel="Clear"
        disabled={disabled}
        onPress={() => save((current) => clearRole(current, role.id, field))}
      />
    ) : null;

  return (
    <SettingsSection title="Team" info="Which agent each role runs on, in this layer.">
      <TabBar
        theme={theme}
        active={role.id}
        disabled={disabled}
        onPick={setActive}
        tabs={catalog.roles.map((entry) => ({ id: entry.id, label: entry.label, hint: team.roles[entry.id]?.harness ?? entry.defaults.harness }))}
      />
      <SettingsCard>
        <SettingsSelect
          label="Agent"
          hint={`${hint("harness")} · ${role.headless ? "runs headless on flagged turn endings" : `${seat?.mcp.length ?? 0} servers, ${seat?.skills.length ?? 0} skills`}`}
          value={seat?.harness ?? role.defaults.harness}
          options={role.harnesses.map((id) => option(id, catalog.harnesses.find((entry) => entry.id === id)?.label ?? id))}
          onValueChange={(next) => save((current) => setRole(current, role.id, { harness: next }, true))}
          disabled={disabled}
        />
        {reset("harness", "The agent")}
        {models.length > 1 ? (
          <SettingsSelect
            label="Model"
            hint={hint("model")}
            value={seat?.model ?? models[0]!.id}
            options={models.map((model) => option(model.id, model.label))}
            onValueChange={(next) => save((current) => setRole(current, role.id, { model: next }))}
            disabled={disabled}
          />
        ) : null}
        {reset("model", "The model")}
        {thinking.length > 0 ? (
          <SettingsSelect
            label="Thinking"
            hint={hint("thinking")}
            value={seat?.thinking ?? thinking[0]!.id}
            options={thinking.map((entry) => option(entry.id, entry.label))}
            onValueChange={(next) => save((current) => setRole(current, role.id, { thinking: next }))}
            disabled={disabled}
          />
        ) : null}
        {reset("thinking", "The thinking option")}
        <SettingsRow label="Description" hint={role.description || "—"} />
        {role.headless ? null : <SettingsRow label="Provider" hint={seat?.provider ?? "none"} />}
        <SettingsRow label="Servers" hint={seat?.mcp.join(", ") || "none"} />
      </SettingsCard>
    </SettingsSection>
  );
}
