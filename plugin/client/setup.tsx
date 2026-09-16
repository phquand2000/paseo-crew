import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Empty, Facts } from "./bits.tsx";
import type { Catalog, Layer, PaseoProject } from "./data.ts";
import { setMcp, setRole } from "./data.ts";
import { TabBar } from "./tabs.tsx";

type Props = {
  catalog: Catalog;
  available: PaseoProject[];
  theme: PluginTheme;
  disabled: boolean;
  attach(root: string, values: Layer): Promise<string | null>;
  onAttached(slug: string): void;
};

export function SetupSection({ catalog, available, theme, disabled, attach, onAttached }: Props) {
  const [root, setRootPath] = useState<string>("");
  const [draft, setDraft] = useState<Layer>({});
  const [role, setActiveRole] = useState(catalog.roles[0]?.id ?? "");

  if (available.length === 0) {
    return (
      <SettingsSection title="Add a project">
        <SettingsCard>
          <Empty
            theme={theme}
            title="Every project is set up"
            body="Add a repository in Paseo and it shows up here, ready for Seatworks."
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const chosen = catalog.roles.find((entry) => entry.id === role) ?? catalog.roles[0]!;
  const harnessOf = (id: string) => draft.roles?.[id]?.harness ?? catalog.roles.find((entry) => entry.id === id)?.defaults.harness ?? "";
  const models = catalog.harnesses.find((entry) => entry.id === harnessOf(chosen.id))?.models ?? [];
  const off = catalog.mcp.filter((entry) => !(draft.mcp?.[entry.id]?.enabled ?? entry.defaults.enabled)).map((entry) => entry.label);
  const picked = available.find((entry) => entry.root === root);

  return (
    <SettingsSection title="Add a project" info={`Pick a repository, choose who works on it, then attach. ${chosen.label}: ${chosen.description}`}>
      <SettingsCard>
        <SettingsSelect
          label="Repository"
          hint={picked ? picked.root : "Projects Paseo knows that Seatworks has no settings for."}
          value={root}
          options={[{ label: "Pick a repository", value: "" }, ...available.map((entry) => ({ label: entry.name, value: entry.root }))]}
          onValueChange={setRootPath}
          disabled={disabled}
        />
      </SettingsCard>

      <SettingsCard>
        <TabBar theme={theme} active={chosen.id} disabled={disabled} onPick={setActiveRole} tabs={catalog.roles.map((entry) => ({ id: entry.id, label: entry.label }))} />
        <SettingsSelect
          label="Agent"
          hint={`Runs every ${chosen.label} turn in this repository.`}
          value={harnessOf(chosen.id)}
          options={chosen.harnesses.map((id) => ({ label: catalog.harnesses.find((entry) => entry.id === id)?.label ?? id, value: id }))}
          onValueChange={(next) => setDraft((current) => setRole(current, chosen.id, { harness: next }, true))}
          disabled={disabled}
        />
        {models.length > 1 ? (
          <SettingsSelect
            label="Model"
            hint="Used for every lane in this project."
            value={draft.roles?.[chosen.id]?.model ?? models[0]!.id}
            options={models.map((model) => ({ label: model.label, value: model.id }))}
            onValueChange={(next) => setDraft((current) => setRole(current, chosen.id, { model: next }))}
            disabled={disabled}
          />
        ) : null}
      </SettingsCard>

      <SettingsCard>
        <SettingsRow label="Servers" hint="Switch off what this repository should not reach." />
        {catalog.mcp.map((entry) => (
          <SettingsSwitch
            key={entry.id}
            label={entry.label}
            hint={entry.description}
            value={draft.mcp?.[entry.id]?.enabled ?? entry.defaults.enabled}
            onValueChange={(next) => setDraft((current) => setMcp(current, entry.id, { enabled: next }))}
            disabled={disabled}
          />
        ))}
      </SettingsCard>

      <SettingsCard>
        <Facts
          theme={theme}
          items={[
            { label: "Repository", value: picked?.name ?? "none picked" },
            { label: "Roles changed", value: Object.keys(draft.roles ?? {}).length ? Object.keys(draft.roles ?? {}).join(", ") : "catalog defaults" },
            { label: "Servers off", value: off.length ? off.join(", ") : "none" },
          ]}
        />
        <SettingsAction
          label="Attach Seatworks"
          hint={root ? "Saves these choices as this project's layer." : "Pick a repository first."}
          actionLabel={disabled ? "Working" : "Attach"}
          disabled={disabled || !root}
          onPress={() =>
            void attach(root, draft).then((slug) => {
              if (!slug) return;
              setDraft({});
              setRootPath("");
              onAttached(slug);
            })
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
