import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Empty, Facts } from "./bits.tsx";
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
  const toast = useToast();
  const wasSaving = useRef(false);
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      body: { padding: layout.compact ? 12 : 20, gap: 16 },
      centered: { flex: 1, padding: 24, gap: 12, backgroundColor: theme.colors.surface0 },
      muted: { color: theme.colors.foregroundMuted },
      danger: { color: theme.colors.statusDanger },
    }),
    [theme, layout.compact],
  );

  useEffect(() => {
    if (wasSaving.current && !saving && !saveError) toast.show("Saved", { variant: "success" });
    wasSaving.current = saving;
  }, [saving, saveError, toast]);

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

  const nameOf = (slug: string, root: string) => data.known.find((entry) => entry.root === root)?.name ?? slug;
  const tabs = [
    { id: MACHINE, label: "This machine" },
    ...data.projects.map((entry) => ({ id: entry.slug, label: nameOf(entry.slug, entry.root) })),
    { id: ADD, label: "Add project", count: data.candidates.length },
  ];
  const here = data.projects.find((entry) => entry.slug === project);
  const layer = project ? "project" : "machine";
  const problems = [...(data.settingsError ? [data.settingsError] : []), ...(saveError ? [saveError] : []), ...data.team.errors];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <TabBar theme={theme} tabs={tabs} active={tab} disabled={saving} onPick={setTab} />
      {problems.length > 0 ? (
        <SettingsSection title="Needs your attention">
          <SettingsCard>
            {problems.map((problem) => (
              <SettingsRow key={problem} label="Problem" error={problem} />
            ))}
          </SettingsCard>
        </SettingsSection>
      ) : null}
      {tab === ADD ? (
        <SetupSection catalog={data.catalog} available={data.candidates} theme={theme} disabled={saving} attach={attach} onAttached={setTab} />
      ) : (
        <>
          {tab === MACHINE && data.projects.length === 0 ? (
            <SettingsSection title="Projects">
              <SettingsCard>
                <Empty
                  theme={theme}
                  title="No project uses Seatworks yet"
                  body="These choices are this machine's defaults. Open Add project to set a repository up."
                />
              </SettingsCard>
            </SettingsSection>
          ) : null}
          {here ? (
            <SettingsSection title={nameOf(here.slug, here.root)} info="These choices apply to this repository only.">
              <SettingsCard>
                <Facts theme={theme} items={[{ label: "Path", value: here.root }, { label: "State", value: here.slug }]} />
                <SettingsAction
                  label="Remove from this project"
                  hint="Keeps the repository in Paseo. Refused while lanes or tasks are on record."
                  actionLabel="Detach"
                  disabled={saving}
                  onPress={() => void detach(here.slug).then((gone) => gone && setTab(MACHINE))}
                />
              </SettingsCard>
            </SettingsSection>
          ) : null}
          <TeamSection catalog={data.catalog} team={data.team} values={data.values} machine={data.machine} layer={layer} theme={theme} disabled={saving} save={(change) => void save(change)} />
          <McpSection catalog={data.catalog} team={data.team} values={data.values} machine={data.machine} layer={layer} theme={theme} disabled={saving} save={(change) => void save(change)} />
          <MachineSection project={project} theme={theme} runDoctor={runDoctor} readStatus={readStatus} />
        </>
      )}
    </ScrollView>
  );
}
