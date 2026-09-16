import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Catalog, Layer, PaseoProject } from "./data.ts";
import { setMcp, setRole } from "./data.ts";
import { TabBar } from "./tabs.tsx";

type Props = {
  open: boolean;
  catalog: Catalog;
  available: PaseoProject[];
  theme: PluginTheme;
  disabled: boolean;
  onOpenChange(open: boolean): void;
  attach(root: string, values: Layer): Promise<string | null>;
  onAttached(slug: string): void;
};

const STEPS = [
  { id: "repository", label: "1 Repository" },
  { id: "team", label: "2 Team" },
  { id: "servers", label: "3 Servers" },
  { id: "check", label: "4 Check" },
];

export function SetupDialog({ open, catalog, available, theme, disabled, onOpenChange, attach, onAttached }: Props) {
  const [step, setStep] = useState(0);
  const [root, setRootPath] = useState("");
  const [draft, setDraft] = useState<Layer>({});
  const [role, setActiveRole] = useState(catalog.roles[0]?.id ?? "");
  const styles = useMemo(
    () => ({
      footer: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingTop: 8 },
      summary: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 },
      ghost: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: theme.colors.border, minHeight: 38, justifyContent: "center" as const },
      ghostText: { color: theme.colors.foregroundMuted, fontSize: 13 },
      go: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9, backgroundColor: theme.colors.accent, minHeight: 38, justifyContent: "center" as const },
      goText: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
    }),
    [theme],
  );

  const chosen = catalog.roles.find((entry) => entry.id === role) ?? catalog.roles[0];
  const harnessOf = (id: string) => draft.roles?.[id]?.harness ?? catalog.roles.find((entry) => entry.id === id)?.defaults.harness ?? "";
  const models = catalog.harnesses.find((entry) => entry.id === harnessOf(chosen?.id ?? ""))?.models ?? [];
  const off = catalog.mcp.filter((entry) => !(draft.mcp?.[entry.id]?.enabled ?? entry.defaults.enabled)).map((entry) => entry.label);
  const path = root.trim();
  const named = available.find((entry) => entry.root === path);

  const close = () => {
    setDraft({});
    setRootPath("");
    setStep(0);
    onOpenChange(false);
  };

  const summary = () => {
    if (!path) return "Give a repository path to start.";
    if (step === 1) return `${chosen?.label ?? "Every role"} on ${catalog.harnesses.find((entry) => entry.id === harnessOf(chosen?.id ?? ""))?.label ?? "its default agent"}.`;
    if (step === 2) return off.length > 0 ? `${off.join(", ")} switched off.` : "Every server switched on.";
    return `${named?.name ?? path.split("/").filter(Boolean).slice(-1)[0] ?? path} · ${off.length > 0 ? `${off.join(", ")} off` : "every server on"}`;
  };

  return (
    <Modal title="Set Seatworks up for a project" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <TabBar theme={theme} active={STEPS[step]!.id} disabled={disabled} onPick={(id) => setStep(Math.max(0, STEPS.findIndex((entry) => entry.id === id)))} tabs={STEPS} />

        {step === 0 ? (
          <>
            <SettingsCard>
              <SettingsInput
                label="Repository"
                hint="Any repository on this machine. A path inside one registers its root."
                initialValue={root}
                placeholder="/Users/you/project/app"
                onChangeText={setRootPath}
                disabled={disabled}
              />
            </SettingsCard>
            {available.length > 0 ? (
              <SettingsCard>
                <SettingsRow label="Or pick one Paseo already knows" hint="These have no Seatworks settings yet." />
                {available.map((entry) => (
                  <SettingsAction
                    key={entry.root}
                    label={entry.name}
                    hint={entry.root}
                    actionLabel={entry.root === path ? "Picked" : "Pick"}
                    disabled={disabled}
                    onPress={() => setRootPath(entry.root)}
                  />
                ))}
              </SettingsCard>
            ) : null}
          </>
        ) : null}

        {step === 1 && chosen ? (
          <>
            <TabBar theme={theme} active={chosen.id} disabled={disabled} onPick={setActiveRole} tabs={catalog.roles.map((entry) => ({ id: entry.id, label: entry.label }))} />
            <SettingsCard>
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
                  hint="Used for every lane here."
                  value={draft.roles?.[chosen.id]?.model ?? models[0]!.id}
                  options={models.map((model) => ({ label: model.label, value: model.id }))}
                  onValueChange={(next) => setDraft((current) => setRole(current, chosen.id, { model: next }))}
                  disabled={disabled}
                />
              ) : null}
            </SettingsCard>
          </>
        ) : null}

        {step === 2 ? (
          <SettingsCard>
            <SettingsRow label="MCP servers" hint="Switch off what this repository should not reach. You can paste more later." />
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
        ) : null}

        {step === 3 ? (
          <SettingsCard>
            <SettingsRow label="Repository" hint={path || "none"} />
            {catalog.roles.map((entry) => (
              <SettingsRow
                key={entry.id}
                label={entry.label}
                hint={catalog.harnesses.find((harness) => harness.id === harnessOf(entry.id))?.label ?? harnessOf(entry.id)}
              />
            ))}
            <SettingsRow label="Servers" hint={off.length > 0 ? `${off.join(", ")} off` : "every server on"} />
          </SettingsCard>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.summary} numberOfLines={1}>
            {summary()}
          </Text>
          {step > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back a step" style={styles.ghost} onPress={() => setStep(step - 1)}>
              <Text style={styles.ghostText}>Back</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" style={styles.ghost} onPress={close}>
            <Text style={styles.ghostText}>Cancel</Text>
          </Pressable>
          {step < STEPS.length - 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next step"
              disabled={disabled || !path}
              style={[styles.go, disabled || !path ? { opacity: 0.5 } : null]}
              onPress={() => setStep(step + 1)}
            >
              <Text style={styles.goText}>Next</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach Seatworks to this project"
              disabled={disabled || !path}
              style={[styles.go, disabled || !path ? { opacity: 0.5 } : null]}
              onPress={() =>
                void attach(path, draft).then((slug) => {
                  if (!slug) return;
                  close();
                  onAttached(slug);
                })
              }
            >
              <Text style={styles.goText}>Attach</Text>
            </Pressable>
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}
