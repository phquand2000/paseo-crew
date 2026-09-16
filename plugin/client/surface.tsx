import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useSeatworks } from "./data.ts";
import { MachineSection } from "./machine.tsx";
import { McpSection } from "./mcp.tsx";
import { SetupSection } from "./setup.tsx";
import { TabBar } from "./tabs.tsx";
import { TeamSection } from "./team.tsx";

const MACHINE = "machine";
const ADD = "add";

export function SeatworksSurface({ theme, layout }: PluginSurfaceProps) {
  const [tab, setTab] = useState<string>(MACHINE);
  const project = tab === MACHINE || tab === ADD ? undefined : tab;
  const { data, save, reload, saving, saveError, attach, detach, runDoctor, readStatus } = useSeatworks(project);
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

  const available = data.candidates;
  const nameOf = (slug: string, root: string) => data.known.find((entry) => entry.root === root)?.name ?? slug;
  const tabs = [
    { id: MACHINE, label: "This machine", hint: "defaults" },
    ...data.projects.map((entry) => ({ id: entry.slug, label: nameOf(entry.slug, entry.root), hint: "project" })),
    { id: ADD, label: "Add project", hint: `${available.length} waiting` },
  ];
  const here = data.projects.find((entry) => entry.slug === project);
  const layer = project ? "project" : "machine";
  const problems = [...(data.settingsError ? [data.settingsError] : []), ...(saveError ? [saveError] : []), ...data.team.errors];
  const locked = saving;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <TabBar theme={theme} tabs={tabs} active={tab} disabled={locked} onPick={setTab} />
      {problems.length > 0 ? (
        <SettingsSection title="Problems">
          <SettingsCard>
            {problems.map((problem) => (
              <SettingsRow key={problem} label="Problem" error={problem} />
            ))}
          </SettingsCard>
        </SettingsSection>
      ) : null}
      {tab === ADD ? (
        <SetupSection catalog={data.catalog} available={available} theme={theme} disabled={locked} attach={attach} onAttached={setTab} />
      ) : (
        <>
          {here ? (
            <SettingsSection title={nameOf(here.slug, here.root)} info="These settings apply to this repository only; everything else follows the machine layer.">
              <SettingsCard>
                <SettingsRow label="Path" hint={here.root} />
                <SettingsRow label="State" hint={here.slug} />
                <SettingsAction
                  label="Remove Seatworks from this project"
                  hint="Drops its settings. It stays a Paseo project, and a project with lanes or tasks on record is kept."
                  actionLabel="Detach"
                  disabled={locked}
                  onPress={() => void detach(here.slug).then((gone) => gone && setTab(MACHINE))}
                />
              </SettingsCard>
            </SettingsSection>
          ) : null}
          <TeamSection catalog={data.catalog} team={data.team} values={data.values} machine={data.machine} layer={layer} theme={theme} disabled={locked} save={(change) => void save(change)} />
          <McpSection catalog={data.catalog} team={data.team} values={data.values} machine={data.machine} layer={layer} theme={theme} disabled={locked} save={(change) => void save(change)} />
          <MachineSection project={project} theme={theme} runDoctor={runDoctor} readStatus={readStatus} />
        </>
      )}
    </ScrollView>
  );
}
