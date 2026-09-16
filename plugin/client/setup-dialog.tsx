import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { SettingsCard, SettingsRow, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Empty } from "./bits.tsx";
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

export function SetupDialog({ open, catalog, available, theme, disabled, onOpenChange, attach, onAttached }: Props) {
  const [root, setRootPath] = useState("");
  const [draft, setDraft] = useState<Layer>({});
  const [role, setActiveRole] = useState(catalog.roles[0]?.id ?? "");
  const styles = useMemo(
    () => ({
      footer: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingTop: 8 },
      summary: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 },
      cancel: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: theme.colors.border, minHeight: 38, justifyContent: "center" as const },
      cancelText: { color: theme.colors.foregroundMuted, fontSize: 13 },
      attach: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9, backgroundColor: theme.colors.accent, minHeight: 38, justifyContent: "center" as const },
      attachText: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
    }),
    [theme],
  );

  const chosen = catalog.roles.find((entry) => entry.id === role) ?? catalog.roles[0];
  const harnessOf = (id: string) => draft.roles?.[id]?.harness ?? catalog.roles.find((entry) => entry.id === id)?.defaults.harness ?? "";
  const models = catalog.harnesses.find((entry) => entry.id === harnessOf(chosen?.id ?? ""))?.models ?? [];
  const off = catalog.mcp.filter((entry) => !(draft.mcp?.[entry.id]?.enabled ?? entry.defaults.enabled)).map((entry) => entry.label);
  const picked = available.find((entry) => entry.root === root);

  const close = () => {
    setDraft({});
    setRootPath("");
    onOpenChange(false);
  };

  return (
    <Modal title="Set Seatworks up for a project" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        {available.length === 0 || !chosen ? (
          <Empty theme={theme} title="Every repository is set up" body="Add one in Paseo and it shows up here, ready for Seatworks." />
        ) : (
          <>
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
            <SettingsCard>
              <SettingsRow label="Servers" hint="Switch off what this repository should not reach." />
              {catalog.mcp.map((entry) => (
                <SettingsSwitch
                  key={entry.id}
                  label={entry.label}
                  value={draft.mcp?.[entry.id]?.enabled ?? entry.defaults.enabled}
                  onValueChange={(next) => setDraft((current) => setMcp(current, entry.id, { enabled: next }))}
                  disabled={disabled}
                />
              ))}
            </SettingsCard>
            <View style={styles.footer}>
              <Text style={styles.summary} numberOfLines={1}>
                {picked ? `${picked.name} · ${off.length > 0 ? `${off.join(", ")} off` : "every server on"}` : "Pick a repository first."}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel" style={styles.cancel} onPress={close}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Attach Seatworks to this project"
                disabled={disabled || !root}
                style={[styles.attach, disabled || !root ? { opacity: 0.5 } : null]}
                onPress={() =>
                  void attach(root, draft).then((slug) => {
                    if (!slug) return;
                    close();
                    onAttached(slug);
                  })
                }
              >
                <Text style={styles.attachText}>Attach</Text>
              </Pressable>
            </View>
          </>
        )}
      </Modal.Content>
    </Modal>
  );
}
