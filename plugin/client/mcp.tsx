import { SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import type { Catalog, Layer, Scalar, SettingSpec, TeamView } from "./data.ts";
import { setMcp } from "./data.ts";

type Entry = Catalog["mcp"][number];

type Props = {
  catalog: Catalog;
  team: TeamView;
  disabled: boolean;
  save(change: (values: Layer) => Layer): void;
};

const toggle = (roles: string[], role: string, on: boolean): string[] => (on ? [...new Set([...roles, role])] : roles.filter((entry) => entry !== role));

function ServerSettings({ entry, current, disabled, save }: { entry: Entry; current: Record<string, Scalar>; disabled: boolean; save: Props["save"] }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const typed = (key: string, spec: SettingSpec): Scalar => {
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
            value={Boolean(current[key] ?? spec.default ?? false)}
            onValueChange={(next) => save((values) => setMcp(values, entry.id, { settings: { [key]: next } }))}
            disabled={disabled}
          />
        ) : (
          <SettingsInput
            key={key}
            label={spec.label}
            initialValue={String(current[key] ?? spec.default ?? "")}
            onChangeText={(text) => setDraft((last) => ({ ...last, [key]: text }))}
            disabled={disabled}
          />
        ),
      )}
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

export function McpSection({ catalog, team, disabled, save }: Props) {
  return (
    <SettingsSection title="MCP servers" info="Servers the seats get, and the roles that get them.">
      {catalog.mcp.map((entry) => {
        const state = team.mcp[entry.id];
        const roles = state?.roles ?? entry.roles;
        return (
          <SettingsCard key={entry.id}>
            <SettingsSwitch
              label={entry.label}
              hint={entry.description}
              value={state?.enabled ?? entry.defaults.enabled}
              onValueChange={(next) => save((values) => setMcp(values, entry.id, { enabled: next }))}
              disabled={disabled}
            />
            {entry.roles.map((role) => (
              <SettingsSwitch
                key={role}
                label={`Given to the ${role}`}
                value={roles.includes(role)}
                onValueChange={(next) => save((values) => setMcp(values, entry.id, { roles: toggle(roles, role, next) }))}
                disabled={disabled || !(state?.enabled ?? entry.defaults.enabled)}
              />
            ))}
            <ServerSettings entry={entry} current={state?.settings ?? {}} disabled={disabled} save={save} />
            <SettingsRow label="Reached over" hint={entry.transport} />
          </SettingsCard>
        );
      })}
    </SettingsSection>
  );
}
