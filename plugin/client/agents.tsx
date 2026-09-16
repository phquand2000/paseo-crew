import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { Badge, Facts } from "./bits.tsx";
import type { Catalog, Check } from "./data.ts";

type Props = {
  catalog: Catalog;
  checks: Check[] | null;
  theme: PluginTheme;
};

export function AgentsSection({ catalog, checks, theme }: Props) {
  const styles = useMemo(
    () => ({
      head: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 },
      labels: { flex: 1, gap: 3 },
      name: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
      id: { color: theme.colors.foregroundMuted, fontSize: 12 },
      body: { paddingHorizontal: 18, paddingBottom: 16 },
      note: { padding: 18, gap: 4 },
      noteTitle: { color: theme.colors.foreground, fontSize: 13, fontWeight: "500" as const },
      noteBody: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
    }),
    [theme],
  );

  const status = (id: string): "good" | "quiet" | null => {
    const check = (checks ?? []).find((entry) => entry.id === `harness:${id}`);
    return check ? (check.ok ? "good" : "quiet") : null;
  };

  return (
    <SettingsSection title="Agents" info="These are the agents this plugin ships. A role can pick nothing else.">
      {catalog.harnesses.map((harness) => {
        const roles = catalog.roles.filter((role) => role.harnesses.includes(harness.id)).map((role) => role.label);
        const tone = status(harness.id);
        return (
          <SettingsCard key={harness.id}>
            <View style={styles.head}>
              <View style={styles.labels}>
                <Text style={styles.name}>{harness.label}</Text>
                <Text style={styles.id}>{harness.id}</Text>
              </View>
              {tone ? <Badge label={tone === "good" ? "on PATH" : "not installed"} tone={tone} theme={theme} /> : null}
            </View>
            <View style={styles.body}>
              <Facts
                theme={theme}
                items={[
                  { label: "Models", value: harness.models.map((model) => model.id).join(", ") || "none" },
                  { label: "Roles it can run", value: roles.join(", ") || "none" },
                  { label: "Thinking options", value: harness.thinking ? "yes" : "no" },
                  { label: "Reaches servers over", value: harness.transports.join(", ") },
                ]}
              />
            </View>
          </SettingsCard>
        );
      })}
      <SettingsCard>
        <View style={styles.note}>
          <Text style={styles.noteTitle}>Want another agent?</Text>
          <Text style={styles.noteBody}>
            Fork the plugin and drop a folder into harness/: a manifest, plus one permission file for each role it may run. The plugin picks it up; nothing under server/ changes.
          </Text>
        </View>
      </SettingsCard>
    </SettingsSection>
  );
}
