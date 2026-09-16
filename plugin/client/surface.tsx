import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useSeatworks } from "./data.ts";
import { MachineSection } from "./machine.tsx";
import { McpSection } from "./mcp.tsx";
import { TeamSection } from "./team.tsx";

const MACHINE = "";

export function SeatworksSurface({ theme, layout }: PluginSurfaceProps) {
  const [project, setProject] = useState<string>(MACHINE);
  const chosen = project === MACHINE ? undefined : project;
  const { data, save, reload, saving, saveError, runDoctor, readStatus } = useSeatworks(chosen);
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      body: { padding: layout.compact ? 12 : 20, gap: 12 },
      centered: { flex: 1, padding: 24, gap: 12, backgroundColor: theme.colors.surface0 },
      muted: { color: theme.colors.foregroundMuted },
      danger: { color: theme.colors.statusDanger },
    }),
    [theme, layout.compact],
  );

  if (data.status === "loading") {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Reading the catalog and the settings.</Text>
      </View>
    );
  }
  if (data.status === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.danger}>{data.error}</Text>
        <SettingsAction label="Seatworks" hint="The plugin did not answer." actionLabel="Try again" onPress={reload} />
      </View>
    );
  }

  const problems = [...(data.settingsError ? [data.settingsError] : []), ...(saveError ? [saveError] : []), ...data.team.errors];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <SettingsSection title="Settings layer" info="The machine layer holds your defaults; a project layer overrides them for that repository.">
        <SettingsSelect
          label="Editing"
          hint={saving ? "Saving" : "Changes reach new agents, not running ones."}
          value={project}
          options={[{ label: "This machine", value: MACHINE }, ...data.projects.map((entry) => ({ label: entry.slug, value: entry.slug }))]}
          onValueChange={setProject}
          disabled={saving}
        />
      </SettingsSection>
      {problems.length > 0 ? (
        <SettingsSection title="Problems">
          <SettingsCard>
            {problems.map((problem) => (
              <SettingsRow key={problem} label="" hint={problem} error={problem} />
            ))}
          </SettingsCard>
        </SettingsSection>
      ) : null}
      <TeamSection catalog={data.catalog} team={data.team} disabled={saving} save={(change) => void save(change)} />
      <McpSection catalog={data.catalog} team={data.team} disabled={saving} save={(change) => void save(change)} />
      <MachineSection project={chosen} theme={theme} runDoctor={runDoctor} readStatus={readStatus} />
    </ScrollView>
  );
}
