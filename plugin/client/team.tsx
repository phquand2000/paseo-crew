import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import type { Catalog, Layer, TeamView } from "./data.ts";
import { setRole } from "./data.ts";

type Props = {
  catalog: Catalog;
  team: TeamView;
  disabled: boolean;
  save(change: (values: Layer) => Layer): void;
};

const option = (id: string, label: string) => ({ label, value: id });

export function TeamSection({ catalog, team, disabled, save }: Props) {
  return (
    <SettingsSection title="Team" info="Which agent each role runs on.">
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
              hint={role.headless ? "Runs headless on flagged turn endings." : `${servers} server${servers === 1 ? "" : "s"}, ${seat?.skills.length ?? 0} skills`}
              value={seat?.harness ?? role.defaults.harness}
              options={role.harnesses.map((id) => option(id, catalog.harnesses.find((entry) => entry.id === id)?.label ?? id))}
              onValueChange={(next) => save((values) => setRole(values, role.id, { harness: next }, true))}
              disabled={disabled}
            />
            {models.length > 1 ? (
              <SettingsSelect
                label="Model"
                value={seat?.model ?? models[0]!.id}
                options={models.map((model) => option(model.id, model.label))}
                onValueChange={(next) => save((values) => setRole(values, role.id, { model: next }))}
                disabled={disabled}
              />
            ) : null}
            {thinking.length > 0 ? (
              <SettingsSelect
                label="Thinking"
                value={seat?.thinking ?? thinking[0]!.id}
                options={thinking.map((entry) => option(entry.id, entry.label))}
                onValueChange={(next) => save((values) => setRole(values, role.id, { thinking: next }))}
                disabled={disabled}
              />
            ) : null}
            {seat && !role.headless ? <SettingsRow label="Provider" hint={seat.provider ?? "none"} /> : null}
          </SettingsCard>
        );
      })}
    </SettingsSection>
  );
}
