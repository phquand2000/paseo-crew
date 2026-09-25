import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { type ReactElement, useState } from "react";
import { modelsRpc } from "../../shared/rpc.ts";
import { Text } from "react-native";
import { sourceLabel } from "./bits.tsx";
import type { Layer, RoleChoice } from "../../shared/settings.ts";
import type { CatalogView, ModelsRefreshed, TeamView } from "../../shared/views.ts";
import { message } from "../format/error.ts";
import { modelRow, setAttention, setRole, sourceOf } from "../model/layer.ts";
import { JudgeCard } from "./judge.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { TabBar } from "./tabs.tsx";

type Props = {
  catalog: CatalogView;
  team: TeamView;
  values: Layer;
  machine: Layer;
  layer: "machine" | "project";
  theme: PluginTheme;
  disabled: boolean;
  active: string | null;
  onActive(role: string): void;
  save(change: (values: Layer) => Layer): Promise<boolean>;
  reload(): void;
};


/** The models are Paseo's: it asks each agent, and this asks Paseo to do it again. */
function ModelsCard({ catalog, disabled, reload }: Pick<Props, "catalog" | "disabled" | "reload">) {
  const refresh = useRpc(modelsRpc);
  const [busy, setBusy] = useState(false);
  const [listed, setListed] = useState<ModelsRefreshed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = (id: string) => catalog.harnesses.find((entry) => entry.id === id)?.label ?? id;
  const failed = listed ? Object.entries(listed).filter(([, entry]) => entry.error) : [];
  const hint = listed
    ? Object.entries(listed).map(([id, entry]) => `${label(id)} ${entry.count}`).join(" · ")
    : catalog.harnesses.map((entry) => `${entry.label} ${entry.models.length}`).join(" · ");
  return (
    <SettingsCard>
      <SettingsAction
        label="Models"
        hint={`Listed by Paseo: ${hint}`}
        error={error ?? (failed.length ? failed.map(([id, entry]) => `${label(id)}: ${entry.error}`).join("\n") : null)}
        actionLabel={busy ? "Asking" : "Refresh"}
        disabled={disabled || busy}
        onPress={() => {
          setBusy(true);
          setError(null);
          refresh({})
            .then((next) => {
              setListed(next);
              reload();
            })
            .catch((problem) => setError(message(problem)))
            .finally(() => setBusy(false));
        }}
      />
    </SettingsCard>
  );
}

type Role = CatalogView["roles"][number];

/** Rows, not a component: the card borders each child it gets. */
function roleRows({ catalog, team, values, machine, layer, theme, disabled, save, role }: Omit<Props, "active" | "onActive" | "reload"> & { role: Role }): ReactElement[] {
  const seat = team.roles[role.id];
  const follows = role.follows ? catalog.roles.find((entry) => entry.id === role.follows)?.label : undefined;
  const harness = catalog.harnesses.find((entry) => entry.id === seat?.harness);
  const models = harness?.models ?? [];
  const model = seat?.model ?? models[0]?.id ?? "";
  const row = modelRow(model, models);
  const stray = row.stray;
  const thinking = models.find((entry) => entry.id === model)?.thinkingOptions ?? [];
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
      <ModelPicker
        key="model"
        label="Model"
        hint={stray ? `${model} is not one this agent offers. Pick one it does.` : sourceLabel(source("model"), layer, follows)}
        value={row.value}
        options={row.options}
        theme={theme}
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

/** On the Supervisor's chip, since what pages and what is about a Lead goes to it: whether what the code notices is mailed at all. */
function IncidentMailCard({ team, values, machine, layer, disabled, save }: Props) {
  return (
    <SettingsCard>
      <SettingsSwitch
        label="Mail incidents"
        hint={`What the code notices about a Lead or a Peer goes to the Lead of its lane, or the Supervisor; never to the seat itself. Pages reach the Supervisor with this off too. ${sourceLabel(sourceOf(values, machine, (entry) => entry.attention?.watch, layer), layer)}.`}
        value={team.attention.watch}
        onValueChange={(next) => void save((current) => setAttention(current, { watch: next }))}
        disabled={disabled}
      />
    </SettingsCard>
  );
}

export function TeamSection(props: Props) {
  const { catalog, theme, disabled, active, onActive } = props;
  const role = catalog.roles.find((entry) => entry.id === active) ?? catalog.roles[0];
  if (!role) return null;
  return (
    <SettingsSection title="Team" info={role.description}>
      <TabBar theme={theme} active={role.id} disabled={disabled} onPick={onActive} tabs={catalog.roles.map((entry) => ({ id: entry.id, label: entry.label }))} />
      {role.can.includes("judge") ? <JudgeCard {...props} role={role} rows={roleRows({ ...props, role })} /> : <SettingsCard>{roleRows({ ...props, role })}</SettingsCard>}
      {role.can.includes("supervise") ? <IncidentMailCard {...props} /> : null}
      <ModelsCard catalog={props.catalog} disabled={props.disabled} reload={props.reload} />
    </SettingsSection>
  );
}
