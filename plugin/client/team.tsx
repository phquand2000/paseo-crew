import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { Catalog, Layer, RoleChoice, TeamView } from "./data.ts";
import { clearRole, setRole, sourceOf, sourceText } from "./data.ts";

type Props = {
  catalog: Catalog;
  team: TeamView;
  values: Layer;
  machine: Layer;
  layer: "machine" | "project";
  disabled: boolean;
  save(change: (values: Layer) => Layer): void;
};

const option = (id: string, label: string) => ({ label, value: id });

export function TeamSection({ catalog, team, values, machine, layer, disabled, save }: Props) {
  const reset = (role: string, field: keyof RoleChoice, label: string) => {
    const source = sourceOf(values, machine, (entry) => entry.roles?.[role]?.[field], layer);
    if (source !== "here") return null;
    return (
      <SettingsAction
        label={`${label} is set here`}
        hint={layer === "machine" ? "Clearing it goes back to the catalog default." : "Clearing it follows the machine layer again."}
        actionLabel="Clear"
        disabled={disabled}
        onPress={() => save((current) => clearRole(current, role, field))}
      />
    );
  };
  const hint = (role: string, field: keyof RoleChoice) => sourceText(sourceOf(values, machine, (entry) => entry.roles?.[role]?.[field], layer), layer);

  return (
    <SettingsSection title="Team" info="Which agent each role runs on, for this layer.">
      {catalog.roles.map((role) => {
        const seat = team.roles[role.id];
        const harness = catalog.harnesses.find((entry) => entry.id === seat?.harness);
        const models = harness?.models ?? [];
        const thinking = harness?.thinking === false ? [] : (models.find((model) => model.id === seat?.model)?.thinkingOptions ?? []);
        const servers = seat?.mcp.length ?? 0;
        return (
          <SettingsCard key={role.id}>
            <SettingsSelect
              label={role.label}
              hint={`${hint(role.id, "harness")} · ${role.headless ? "runs headless" : `${servers} server${servers === 1 ? "" : "s"}, ${seat?.skills.length ?? 0} skills`}`}
              value={seat?.harness ?? role.defaults.harness}
              options={role.harnesses.map((id) => option(id, catalog.harnesses.find((entry) => entry.id === id)?.label ?? id))}
              onValueChange={(next) => save((current) => setRole(current, role.id, { harness: next }, true))}
              disabled={disabled}
            />
            {reset(role.id, "harness", "The agent")}
            {models.length > 1 ? (
              <SettingsSelect
                label="Model"
                hint={hint(role.id, "model")}
                value={seat?.model ?? models[0]!.id}
                options={models.map((model) => option(model.id, model.label))}
                onValueChange={(next) => save((current) => setRole(current, role.id, { model: next }))}
                disabled={disabled}
              />
            ) : null}
            {reset(role.id, "model", "The model")}
            {thinking.length > 0 ? (
              <SettingsSelect
                label="Thinking"
                hint={hint(role.id, "thinking")}
                value={seat?.thinking ?? thinking[0]!.id}
                options={thinking.map((entry) => option(entry.id, entry.label))}
                onValueChange={(next) => save((current) => setRole(current, role.id, { thinking: next }))}
                disabled={disabled}
              />
            ) : null}
            {reset(role.id, "thinking", "The thinking option")}
            {seat && !role.headless ? <SettingsRow label="Provider" hint={seat.provider ?? "none"} /> : null}
          </SettingsCard>
        );
      })}
    </SettingsSection>
  );
}
