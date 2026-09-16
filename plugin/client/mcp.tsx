import { SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import type { Catalog, Layer, McpChoice, Scalar, SettingSpec, TeamView } from "./data.ts";
import { clearMcp, clearMcpSetting, setMcp, sourceOf, sourceText } from "./data.ts";

type Entry = Catalog["mcp"][number];

type Props = {
  catalog: Catalog;
  team: TeamView;
  values: Layer;
  machine: Layer;
  layer: "machine" | "project";
  disabled: boolean;
  save(change: (values: Layer) => Layer): void;
};

const toggle = (roles: string[], role: string, on: boolean): string[] => (on ? [...new Set([...roles, role])] : roles.filter((entry) => entry !== role));

function ServerSettings({ entry, current, disabled, save, hintOf, resetOf }: {
  entry: Entry;
  current: Record<string, Scalar>;
  disabled: boolean;
  save: Props["save"];
  hintOf(key: string): string;
  resetOf(key: string): boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const typed = (key: string, spec: SettingSpec): Scalar => {
    const text = draft[key] ?? String(current[key] ?? "");
    return spec.type === "number" ? Number(text) : text;
  };
  const edited = Object.keys(draft).filter((key) => draft[key] !== String(current[key] ?? ""));
  const wrong = edited.some((key) => entry.settings[key]?.type === "number" && !Number.isFinite(Number(draft[key])));
  return (
    <>
      {Object.entries(entry.settings).map(([key, spec]) => (
        <ServerSetting
          key={key}
          spec={spec}
          hint={hintOf(key)}
          value={current[key] ?? spec.default ?? ""}
          disabled={disabled}
          onBoolean={(next) => save((values) => setMcp(values, entry.id, { settings: { [key]: next } }))}
          onText={(text) => setDraft((last) => ({ ...last, [key]: text }))}
          onClear={resetOf(key) ? () => save((values) => clearMcpSetting(values, entry.id, key)) : undefined}
        />
      ))}
      {edited.length > 0 ? (
        <SettingsAction
          label="Apply"
          hint={wrong ? "A number setting needs a number." : `${edited.length} change${edited.length === 1 ? "" : "s"} waiting`}
          error={wrong ? "A number setting needs a number." : null}
          actionLabel="Save"
          disabled={disabled || wrong}
          onPress={() => {
            const settings = Object.fromEntries(edited.map((key) => [key, typed(key, entry.settings[key]!)]));
            setDraft({});
            save((values) => setMcp(values, entry.id, { settings }));
          }}
        />
      ) : null}
    </>
  );
}

function ServerSetting({ spec, hint, value, disabled, onBoolean, onText, onClear }: {
  spec: SettingSpec;
  hint: string;
  value: Scalar;
  disabled: boolean;
  onBoolean(next: boolean): void;
  onText(text: string): void;
  onClear?: () => void;
}) {
  return (
    <>
      {spec.type === "boolean" ? (
        <SettingsSwitch label={spec.label} hint={hint} value={Boolean(value)} onValueChange={onBoolean} disabled={disabled} />
      ) : (
        <SettingsInput label={spec.label} hint={hint} initialValue={String(value)} onChangeText={onText} disabled={disabled} />
      )}
      {onClear ? <SettingsAction label={`${spec.label} is set here`} hint="Clear it to follow the layer below." actionLabel="Clear" disabled={disabled} onPress={onClear} /> : null}
    </>
  );
}

export function McpSection({ catalog, team, values, machine, layer, disabled, save }: Props) {
  const hint = (id: string, field: keyof McpChoice) => sourceText(sourceOf(values, machine, (entry) => entry.mcp?.[id]?.[field], layer), layer);
  const setHere = (id: string, field: keyof McpChoice) => sourceOf(values, machine, (entry) => entry.mcp?.[id]?.[field], layer) === "here";
  const clear = (id: string, field: keyof McpChoice, label: string) =>
    setHere(id, field) ? (
      <SettingsAction
        label={`${label} is set here`}
        hint={layer === "machine" ? "Clearing it goes back to the catalog default." : "Clearing it follows the machine layer again."}
        actionLabel="Clear"
        disabled={disabled}
        onPress={() => save((current) => clearMcp(current, id, field))}
      />
    ) : null;

  return (
    <SettingsSection title="MCP servers" info="Servers the seats get, and the roles that get them.">
      {catalog.mcp.map((entry) => {
        const state = team.mcp[entry.id];
        const roles = state?.roles ?? entry.roles;
        const on = state?.enabled ?? entry.defaults.enabled;
        return (
          <SettingsCard key={entry.id}>
            <SettingsSwitch
              label={entry.label}
              hint={`${hint(entry.id, "enabled")} · ${entry.description}`}
              value={on}
              onValueChange={(next) => save((current) => setMcp(current, entry.id, { enabled: next }))}
              disabled={disabled}
            />
            {clear(entry.id, "enabled", "On or off")}
            {entry.roles.map((role) => (
              <SettingsSwitch
                key={role}
                label={`Given to the ${role}`}
                value={roles.includes(role)}
                onValueChange={(next) => save((current) => setMcp(current, entry.id, { roles: toggle(roles, role, next) }))}
                disabled={disabled || !on}
              />
            ))}
            {clear(entry.id, "roles", "The roles")}
            <ServerSettings
              entry={entry}
              current={state?.settings ?? {}}
              disabled={disabled}
              save={save}
              hintOf={(key) => sourceText(sourceOf(values, machine, (current) => current.mcp?.[entry.id]?.settings?.[key], layer), layer)}
              resetOf={(key) => sourceOf(values, machine, (current) => current.mcp?.[entry.id]?.settings?.[key], layer) === "here"}
            />
            <SettingsRow label="Reached over" hint={entry.transport} />
          </SettingsCard>
        );
      })}
    </SettingsSection>
  );
}
