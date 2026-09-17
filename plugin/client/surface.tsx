import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Empty } from "./bits.tsx";
import type { Check } from "./data.ts";
import { useFlow, useSeatworks } from "./data.ts";
import { type DetailTab, Detail } from "./detail.tsx";
import { FlowSection } from "./flow.tsx";
import { HealthSection } from "./health.tsx";
import { MACHINE, ProjectList } from "./projects.tsx";
import { ServersSection } from "./servers.tsx";
import { SetupDialog } from "./setup-dialog.tsx";
import { TeamSection } from "./team.tsx";

export function SeatworksSurface({ theme, layout }: PluginSurfaceProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("team");
  const [dialog, setDialog] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [openLanes, setOpenLanes] = useState<string[]>([]);
  const project = open && open !== MACHINE ? open : undefined;
  const { data, save, reload, saving, saveError, addServer, attach, detach, listFolders, runDoctor, readStatus } = useSeatworks(project);
  const settings = data.status === "ready" ? data : null;
  const flowLive = settings ? (settings.values.flow?.live ?? settings.machine.flow?.live ?? true) : true;
  const flowEvery = settings ? (settings.values.flow?.everySeconds ?? settings.machine.flow?.everySeconds ?? 5) : 5;
  const { flow, error: flowError } = useFlow(tab === "flow" && flowLive ? project : undefined, flowEvery * 1000, openLanes.slice().sort().join(","));
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
  const here = data.projects.find((entry) => entry.slug === project);
  const layer = project ? "project" : "machine";
  const problems = [...(data.settingsError ? [data.settingsError] : []), ...(saveError ? [saveError] : []), ...data.team.errors];
  // Settings that could not be read are shown as empty, so editing them would save that emptiness over what the file holds.
  const locked = saving || data.settingsError !== null;

  const trouble =
    problems.length > 0 ? (
      <SettingsSection title="Needs your attention">
        <SettingsCard>
          {problems.map((problem) => (
            <SettingsRow key={problem} label="Problem" error={problem} />
          ))}
        </SettingsCard>
      </SettingsSection>
    ) : null;

  const dialogNode = (
    <SetupDialog
      open={dialog}
      catalog={data.catalog}
      available={data.candidates}
      attached={data.projects.map((entry) => entry.root)}
      theme={theme}
      disabled={saving}
      onOpenChange={setDialog}
      attach={attach}
      listFolders={listFolders}
      onAttached={(slug) => {
        setOpen(slug);
        setTab("team");
      }}
    />
  );

  if (!open) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
        {trouble}
        <ProjectList
          projects={data.projects}
          nameOf={nameOf}
          team={data.team}
          waiting={data.candidates.length}
          theme={theme}
          disabled={saving}
          onOpen={(target) => {
            setOpen(target);
            setTab("team");
          }}
          onSetup={() => setDialog(true)}
        />
        {data.projects.length === 0 ? (
          <SettingsCard>
            <Empty theme={theme} title="No project uses Seatworks yet" body="Machine defaults hold until a project sets its own. Use Set up a project to add one." />
          </SettingsCard>
        ) : null}
        {dialogNode}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Detail
        title={here ? nameOf(here.slug, here.root) : "Machine defaults"}
        subtitle={here ? here.root : "Every project that sets nothing of its own follows these."}
        tab={tab}
        theme={theme}
        disabled={saving}
        onBack={() => setOpen(null)}
        onTab={setTab}
        onDetach={here ? () => void detach(here.slug).then((gone) => gone && setOpen(null)) : undefined}
      >
        {trouble}
        {tab === "team" ? (
          <TeamSection catalog={data.catalog} team={data.team} values={data.values} machine={data.machine} layer={layer} theme={theme} disabled={locked} save={(change) => void save(change)} />
        ) : null}
        {tab === "flow" ? (
          <FlowSection
            following={Boolean(project)}
            flow={flow}
            error={flowError}
            live={flowLive}
            open={openLanes}
            theme={theme}
            disabled={locked}
            onLive={(next) => void save((values) => ({ ...values, flow: { ...values.flow, live: next } }))}
            onOpen={(lane) => setOpenLanes((current) => (current.includes(lane) ? current.filter((id) => id !== lane) : [...current, lane]))}
          />
        ) : null}
        {tab === "mcp" ? (
          <ServersSection
            catalog={data.catalog}
            team={data.team}
            values={data.values}
            machine={data.machine}
            layer={layer}
            theme={theme}
            disabled={locked}
            save={(change) => void save(change)}
            addServer={addServer}
          />
        ) : null}
        {tab === "health" ? <HealthSection project={project} theme={theme} checks={checks} onChecks={setChecks} runDoctor={runDoctor} readStatus={readStatus} /> : null}
      </Detail>
      {dialogNode}
    </ScrollView>
  );
}
