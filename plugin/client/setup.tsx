import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
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
  const [role, setRole_] = useState(catalog.roles[0]?.id ?? "");

  if (available.length === 0) {
    return (
      <SettingsSection title="Add a project" info="Seatworks is already set up for every project Paseo knows.">
        <SettingsCard>
          <SettingsRow label="Nothing to add" hint="Add a project in Paseo first, then it shows up here." />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const chosen = catalog.roles.find((entry) => entry.id === role) ?? catalog.roles[0]!;
  const harnessOf = (id: string) => draft.roles?.[id]?.harness ?? catalog.roles.find((entry) => entry.id === id)?.defaults.harness ?? "";
  const models = catalog.harnesses.find((entry) => entry.id === harnessOf(chosen.id))?.models ?? [];

  return (
    <SettingsSection title="Set Seatworks up for a project" info="Pick the repository, choose each role's agent and the servers it gets, then attach.">
      <SettingsCard>
        <SettingsSelect
          label="Repository"
          hint="Projects Paseo knows that Seatworks is not set up for yet."
          value={root}
          options={[{ label: "Pick a repository", value: "" }, ...available.map((entry) => ({ label: entry.name, value: entry.root }))]}
          onValueChange={setRootPath}
          disabled={disabled}
        />
        <SettingsRow label="Path" hint={root || "Nothing picked yet."} />
      </SettingsCard>

      <TabBar
        theme={theme}
        active={chosen.id}
        disabled={disabled}
        onPick={setRole_}
        tabs={catalog.roles.map((entry) => ({ id: entry.id, label: entry.label, hint: harnessOf(entry.id) }))}
      />
      <SettingsCard>
        <SettingsSelect
          label="Agent"
          hint={draft.roles?.[chosen.id]?.harness ? "chosen for this project" : "catalog default"}
          value={harnessOf(chosen.id)}
          options={chosen.harnesses.map((id) => ({ label: catalog.harnesses.find((entry) => entry.id === id)?.label ?? id, value: id }))}
          onValueChange={(next) => setDraft((current) => setRole(current, chosen.id, { harness: next }, true))}
          disabled={disabled}
        />
        {models.length > 1 ? (
          <SettingsSelect
            label="Model"
            hint={draft.roles?.[chosen.id]?.model ? "chosen for this project" : "harness default"}
            value={draft.roles?.[chosen.id]?.model ?? models[0]!.id}
            options={models.map((model) => ({ label: model.label, value: model.id }))}
            onValueChange={(next) => setDraft((current) => setRole(current, chosen.id, { model: next }))}
            disabled={disabled}
          />
        ) : null}
      </SettingsCard>

      <SettingsCard>
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
        <SettingsAction
          label="Attach Seatworks"
          hint={root ? `Registers ${root} and saves these choices as its project layer.` : "Pick a repository first."}
          actionLabel={disabled ? "Working" : "Attach"}
          disabled={disabled || !root}
          onPress={() =>
            void attach(root, draft).then((slug) => {
              if (!slug) return;
              setDraft({});
              onAttached(slug);
            })
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
