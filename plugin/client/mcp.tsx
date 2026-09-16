import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Chips, Facts, Revert, sourceLabel } from "./bits.tsx";
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
  addServer(text: string): Promise<string | null>;
};

const ADD = "__add__";

function Tuning({ entry, current, theme, disabled, save, labelOf, setHere }: {
  entry: Entry;
  current: Record<string, Scalar>;
  theme: PluginTheme;
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
          <SettingsRow key={`revert-${key}`} label={entry.settings[key]!.label} hint="Set here">
            <Revert theme={theme} disabled={disabled} onPress={() => save((values) => clearMcpSetting(values, entry.id, key))} />
          </SettingsRow>
        ))}
    </>
  );
}

export function McpSection({ catalog, team, values, machine, layer, theme, disabled, save, addServer }: Props) {
  const ids = Object.keys(team.mcp);
  const [active, setActive] = useState(ids[0] ?? ADD);
  const [paste, setPaste] = useState("");
  const state = team.mcp[active];
  const entry = catalog.mcp.find((item) => item.id === active);
  const tabs = [...ids.map((id) => ({ id, label: team.mcp[id]!.label })), { id: ADD, label: "Add a server" }];

  if (active === ADD || !state) {
    return (
      <SettingsSection title="Servers" info="Paste the snippet a server gives you. Everything else you choose here afterwards.">
        <TabBar theme={theme} active={ADD} disabled={disabled} onPick={setActive} tabs={tabs} />
        <SettingsCard>
          <SettingsInput
            label="Connection"
            hint={'Example: {"mcp": {"context7": {"type": "local", "command": ["npx", "-y", "@upstash/context7-mcp"]}}}'}
            initialValue=""
            placeholder='{"mcp": { … }}'
            onChangeText={setPaste}
            disabled={disabled}
          />
          <SettingsAction
            label="Add it"
            hint={paste.trim() ? "Saved switched on, given to every role. Narrow it below." : "Paste the snippet first."}
            actionLabel="Add"
            disabled={disabled || !paste.trim()}
            onPress={() =>
              void addServer(paste).then((id) => {
                if (!id) return;
                setPaste("");
                setActive(id);
              })
            }
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const roles = state.roles;
  const on = state.enabled;
  const source = (field: keyof McpChoice) => sourceOf(values, machine, (current) => current.mcp?.[active]?.[field], layer);
  const revert = (field: keyof McpChoice) =>
    source(field) === "here" ? <Revert theme={theme} disabled={disabled} onPress={() => save((current) => clearMcp(current, active, field))} /> : null;

  return (
    <SettingsSection title="Servers" info={entry?.description ?? (state.connect ? "Added here from a pasted snippet." : "")}>
      <TabBar theme={theme} active={active} disabled={disabled} onPick={setActive} tabs={tabs} />
      <SettingsCard>
        <SettingsSwitch
          label="Switched on"
          hint={sourceLabel(source("enabled"), layer)}
          value={on}
          onValueChange={(next) => save((current) => setMcp(current, active, { enabled: next }))}
          disabled={disabled}
        >
          {revert("enabled")}
        </SettingsSwitch>
        <SettingsRow label="Roles that get it" hint={sourceLabel(source("roles"), layer)}>
          <Chips
            theme={theme}
            disabled={disabled || !on}
            chosen={roles}
            options={(entry ? entry.roles : catalog.roles.filter((role) => role.team).map((role) => role.id)).map((role) => ({ id: role, label: role }))}
            onToggle={(role, want) =>
              save((current) => setMcp(current, active, { roles: want ? [...new Set([...roles, role])] : roles.filter((other) => other !== role) }))
            }
          />
          {revert("roles")}
        </SettingsRow>
        {entry ? (
          <Tuning
            entry={entry}
            current={state.settings}
            theme={theme}
            disabled={disabled}
            save={(change) => save(change)}
            labelOf={(key) => sourceLabel(sourceOf(values, machine, (current) => current.mcp?.[active]?.settings?.[key], layer), layer)}
            setHere={(key) => sourceOf(values, machine, (current) => current.mcp?.[active]?.settings?.[key], layer) === "here"}
          />
        ) : null}
        <SettingsAction
          label={state.template ? "Remove this server" : "Remove this server"}
          hint={state.template ? "It stays in the catalog; add it again whenever you want." : "It was added here, so removing it drops it."}
          actionLabel="Remove"
          disabled={disabled}
          onPress={() =>
            save((current) => {
              const next = setMcp(current, active, { removed: true, enabled: false });
              setActive(ids.find((id) => id !== active) ?? ADD);
              return next;
            })
          }
        />
        <Facts
          theme={theme}
          items={[
            { label: "Reached over", value: state.transport },
            { label: "Source", value: state.template ? "catalog template" : "pasted here" },
            ...(state.connect?.command ? [{ label: "Command", value: state.connect.command.join(" ") }] : []),
            ...(state.connect?.url ? [{ label: "Url", value: state.connect.url }] : []),
          ]}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
