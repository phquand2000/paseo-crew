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
  const [root, setRoot] = useState<string>(MACHINE);
  const [project, setProject] = useState<string>(MACHINE);
  const [busy, setBusy] = useState(false);
  const { data, save, reload, saving, saveError, addProject, runDoctor, readStatus } = useSeatworks(project === MACHINE ? undefined : project);
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

  const byRoot = new Map(data.projects.map((entry) => [entry.root, entry.slug]));
  const roots = [...new Set([...data.projects.map((entry) => entry.root), ...data.known.map((entry) => entry.root)])].sort();
  const nameOf = (path: string) => data.known.find((entry) => entry.root === path)?.name ?? byRoot.get(path) ?? path;
  const pick = async (next: string): Promise<void> => {
    setRoot(next);
    if (next === MACHINE) {
      setProject(MACHINE);
      return;
    }
    const known = byRoot.get(next);
    if (known) {
      setProject(known);
      return;
    }
    setBusy(true);
    const slug = await addProject(next);
    setBusy(false);
    if (slug) setProject(slug);
    else setRoot(MACHINE);
  };

  const layer = project === MACHINE ? "machine" : "project";
  const problems = [...(data.settingsError ? [data.settingsError] : []), ...(saveError ? [saveError] : []), ...data.team.errors];
  const locked = saving || busy;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <SettingsSection title="Settings layer" info="The machine layer holds your defaults; a project layer overrides them for that repository only.">
        <SettingsCard>
          <SettingsSelect
            label="Editing"
            hint={locked ? "Saving" : "Changes reach new agents, not running ones."}
            value={root}
            options={[{ label: "This machine", value: MACHINE }, ...roots.map((path) => ({ label: nameOf(path), value: path }))]}
            onValueChange={(next) => void pick(next)}
            disabled={locked}
          />
          {project === MACHINE ? null : <SettingsRow label="Project" hint={`${root} · ${project}`} />}
        </SettingsCard>
      </SettingsSection>
      {problems.length > 0 ? (
        <SettingsSection title="Problems">
          <SettingsCard>
            {problems.map((problem) => (
              <SettingsRow key={problem} label="Problem" error={problem} />
            ))}
          </SettingsCard>
        </SettingsSection>
      ) : null}
      <TeamSection catalog={data.catalog} team={data.team} values={data.values} machine={data.machine} layer={layer} disabled={locked} save={(change) => void save(change)} />
      <McpSection catalog={data.catalog} team={data.team} values={data.values} machine={data.machine} layer={layer} disabled={locked} save={(change) => void save(change)} />
      <MachineSection project={project === MACHINE ? undefined : project} theme={theme} runDoctor={runDoctor} readStatus={readStatus} />
    </ScrollView>
  );
}
