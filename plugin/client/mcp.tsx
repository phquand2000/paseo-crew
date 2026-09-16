import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Chips, Facts, sourceLabel } from "./bits.tsx";
import type { Catalog, Layer, McpChoice, Scalar, SettingSpec, TeamView } from "./data.ts";
import { clearMcp, clearMcpSetting, setMcp, sourceOf } from "./data.ts";
import { TabBar } from "./tabs.tsx";

type Entry = Catalog["mcp"][number];

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

function Tuning({ entry, current, disabled, save, labelOf, setHere }: {
  entry: Entry;
  current: Record<string, Scalar>;
  disabled: boolean;
  save: Props["save"];
  labelOf(key: string): string;
  setHere(key: string): boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const value = (key: string, spec: SettingSpec): Scalar => {
    const text = draft[key] ?? String(current[key] ?? "");
    return spec.type === "number" ? Number(text) : text;
  };
  const edited = Object.keys(draft).filter((key) => draft[key] !== String(current[key] ?? ""));
  const wrong = edited.some((key) => entry.settings[key]?.type === "number" && !Number.isFinite(Number(draft[key])));
  return (
    <>
      {Object.entries(entry.settings).map(([key, spec]) =>
        spec.type === "boolean" ? (
          <SettingsSwitch
            key={key}
            label={spec.label}
            hint={labelOf(key)}
            value={Boolean(current[key] ?? spec.default ?? false)}
            onValueChange={(next) => save((values) => setMcp(values, entry.id, { settings: { [key]: next } }))}
            disabled={disabled}
          />
        ) : (
          <SettingsInput
            key={key}
            label={spec.label}
            hint={labelOf(key)}
            initialValue={String(current[key] ?? spec.default ?? "")}
            onChangeText={(text) => setDraft((last) => ({ ...last, [key]: text }))}
            disabled={disabled}
          />
        ),
      )}
      {edited.length > 0 ? (
        <SettingsAction
          label={wrong ? "That needs a number" : "Unsaved change"}
          error={wrong ? "That needs a number" : null}
          actionLabel="Save"
          disabled={disabled || wrong}
          onPress={() => {
            const settings = Object.fromEntries(edited.map((key) => [key, value(key, entry.settings[key]!)]));
            setDraft({});
            save((values) => setMcp(values, entry.id, { settings }));
          }}
        />
      ) : null}
      {Object.keys(entry.settings)
        .filter((key) => setHere(key))
        .map((key) => (
          <SettingsAction
            key={`revert-${key}`}
            label={entry.settings[key]!.label}
            hint="Back to the layer below"
            actionLabel="Revert"
            disabled={disabled}
            onPress={() => save((values) => clearMcpSetting(values, entry.id, key))}
          />
        ))}
    </>
  );
}

export function McpSection({ catalog, team, values, machine, layer, theme, disabled, save }: Props) {
  const [active, setActive] = useState(catalog.mcp[0]?.id ?? "");
  const entry = catalog.mcp.find((item) => item.id === active) ?? catalog.mcp[0];
  if (!entry) return null;
  const state = team.mcp[entry.id];
  const roles = state?.roles ?? entry.roles;
  const on = state?.enabled ?? entry.defaults.enabled;
  const source = (field: keyof McpChoice) => sourceOf(values, machine, (current) => current.mcp?.[entry.id]?.[field], layer);
  const revert = (field: keyof McpChoice, label: string) =>
    source(field) === "here" ? (
      <SettingsAction
        label={label}
        hint={layer === "machine" ? "Back to the catalog default" : "Back to this machine's choice"}
        actionLabel="Revert"
        disabled={disabled}
        onPress={() => save((current) => clearMcp(current, entry.id, field))}
      />
    ) : null;

  return (
    <SettingsSection title="Servers" info={entry.description}>
      <TabBar theme={theme} active={entry.id} disabled={disabled} onPick={setActive} tabs={catalog.mcp.map((item) => ({ id: item.id, label: item.label }))} />
      <SettingsCard>
        <SettingsSwitch
          label="Switched on"
          hint={sourceLabel(source("enabled"), layer)}
          value={on}
          onValueChange={(next) => save((current) => setMcp(current, entry.id, { enabled: next }))}
          disabled={disabled}
        />
        {revert("enabled", "Switched on")}
        <SettingsRow label="Roles that get it" hint={sourceLabel(source("roles"), layer)}>
          <Chips
            theme={theme}
            disabled={disabled || !on}
            chosen={roles}
            options={entry.roles.map((role) => ({ id: role, label: role }))}
            onToggle={(role, want) =>
              save((current) => setMcp(current, entry.id, { roles: want ? [...new Set([...roles, role])] : roles.filter((entry2) => entry2 !== role) }))
            }
          />
        </SettingsRow>
        {revert("roles", "Roles that get it")}
        <Tuning
          entry={entry}
          current={state?.settings ?? {}}
          disabled={disabled}
          save={save}
          labelOf={(key) => sourceLabel(sourceOf(values, machine, (current) => current.mcp?.[entry.id]?.settings?.[key], layer), layer)}
          setHere={(key) => sourceOf(values, machine, (current) => current.mcp?.[entry.id]?.settings?.[key], layer) === "here"}
        />
        <Facts theme={theme} items={[{ label: "Reached over", value: entry.transport }, { label: "Kind", value: entry.kind }]} />
      </SettingsCard>
    </SettingsSection>
  );
}
