import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { Empty } from "./bits.tsx";
import type { FlowAsk, FlowLane, FlowRole, FlowSeat, FlowTask, FlowView } from "./data.ts";

type Props = { flow: FlowView | null; error: string | null; theme: PluginTheme };

const ago = (minutes: number): string => (minutes < 1 ? "just now" : `${minutes} min`);

function seatLine(seat: FlowSeat | null): string {
  if (!seat) return "no seat";
  if (seat.waiting.length > 0) return `waiting on you: ${seat.waiting[0]}`;
  return `${seat.status} · ${ago(seat.minutes)}`;
}

export function FlowSection({ flow, error, theme }: Props) {
  const styles = useMemo(
    () => ({
      head: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 },
      headLabels: { flex: 1, gap: 3 },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12 },
      chain: { flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16 },
      node: { gap: 5, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2, minWidth: 132 },
      nodeName: { color: theme.colors.foreground, fontSize: 13, fontWeight: "500" as const },
      nodeAgent: { color: theme.colors.foregroundMuted, fontSize: 11 },
      link: { width: 26, height: 1, backgroundColor: theme.colors.border },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 18, paddingVertical: 14 },
      rowLabels: { flex: 1, gap: 4 },
      line: { height: 1, backgroundColor: theme.colors.border },
      live: { fontSize: 11, fontWeight: "500" as const, color: theme.colors.statusSuccess },
      quiet: { fontSize: 11, fontWeight: "500" as const, color: theme.colors.foregroundMuted },
      trailing: { fontSize: 12, fontWeight: "500" as const, color: theme.colors.foregroundMuted },
    }),
    [theme],
  );

  if (error) {
    return (
      <SettingsSection title="Flow" info="What the team holds right now.">
        <SettingsCard>
          <Empty theme={theme} title="The flow could not be read" body={error} />
        </SettingsCard>
      </SettingsSection>
    );
  }
  if (!flow) {
    return (
      <SettingsSection title="Flow" info="What the team holds right now.">
        <SettingsCard>
          <Empty theme={theme} title="Reading the lanes" body="This refreshes on its own every few seconds." />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const chain = flow.roles.filter((role) => !role.headless);
  const headless = flow.roles.filter((role) => role.headless);

  const node = (role: FlowRole, index: number) => (
    <View key={role.id} style={{ flexDirection: "row", alignItems: "center" }}>
      {index > 0 ? <View style={styles.link} /> : null}
      <View style={styles.node}>
        <Text style={styles.nodeName}>{role.label}</Text>
        <Text style={styles.nodeAgent}>{[role.harness, role.model].filter(Boolean).join(" · ")}</Text>
        <Text style={role.seats.length > 0 ? styles.live : styles.quiet}>{role.seats.length > 0 ? seatLine(role.seats[0]!) : "no seat"}</Text>
      </View>
    </View>
  );

  const task = (entry: FlowTask, last: boolean) => (
    <View key={entry.id}>
      <View style={styles.line} />
      <View style={styles.row}>
        <View style={styles.rowLabels}>
          <Text style={styles.title}>{`${entry.id} · ${entry.title}`}</Text>
          <Text style={styles.hint}>
            {entry.peer ? `Peer ${entry.peer.id} · ${seatLine(entry.peer)}` : entry.handback !== null ? `Handed back ${ago(entry.handback)} ago` : `Updated ${ago(entry.minutes)} ago`}
          </Text>
        </View>
        <Text style={styles.trailing}>{entry.status}</Text>
      </View>
      {last ? null : null}
    </View>
  );

  const lane = (entry: FlowLane) => (
    <SettingsCard key={entry.id}>
      <View style={styles.row}>
        <View style={styles.rowLabels}>
          <Text style={styles.title}>{`${entry.id} · ${entry.title}`}</Text>
          <Text style={styles.hint}>{`Branch ${entry.branch} off ${entry.base}. Lead ${entry.lead ? `${entry.lead.id}, ${seatLine(entry.lead)}` : "not seated"}.`}</Text>
        </View>
        <Text style={styles.trailing}>{entry.status}</Text>
      </View>
      {entry.tasks.length === 0 ? (
        <>
          <View style={styles.line} />
          <View style={styles.row}>
            <Text style={styles.hint}>The Lead has not split this lane into a task yet.</Text>
          </View>
        </>
      ) : (
        entry.tasks.map((item, index) => task(item, index === entry.tasks.length - 1))
      )}
    </SettingsCard>
  );

  const ask = (entry: FlowAsk) => (
    <View key={entry.id}>
      <View style={styles.line} />
      <View style={styles.row}>
        <View style={styles.rowLabels}>
          <Text style={styles.title}>{`${entry.id} · ${entry.text}`}</Text>
          <Text style={styles.hint}>{`${entry.kind} · from ${entry.fromRole} ${entry.from} to ${entry.to}`}</Text>
        </View>
        <Text style={styles.trailing}>{ago(entry.minutes)}</Text>
      </View>
    </View>
  );

  return (
    <SettingsSection title="Flow" info="Who holds what right now. It refreshes on its own.">
      <SettingsCard>
        <View style={styles.head}>
          <View style={styles.headLabels}>
            <Text style={styles.title}>The team</Text>
            <Text style={styles.hint}>A hand-back goes back up the chain it came down.</Text>
          </View>
          <Text style={styles.hint}>{flow.gate ? `gate ${flow.gate}` : "no gate"}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chain}>
          {chain.map((role, index) => node(role, index))}
        </ScrollView>
        {headless.map((role) => (
          <View key={role.id}>
            <View style={styles.line} />
            <View style={styles.row}>
              <View style={styles.rowLabels}>
                <Text style={styles.title}>{role.label}</Text>
                <Text style={styles.hint}>Headless. The plugin wakes it on a flagged turn ending; it raises attention to the Supervisor.</Text>
              </View>
              <Text style={styles.quiet}>{[role.harness, role.model].filter(Boolean).join(" · ")}</Text>
            </View>
          </View>
        ))}
      </SettingsCard>

      {flow.lanes.length === 0 ? (
        <SettingsCard>
          <Empty theme={theme} title="No lane is open" body="The Supervisor opens one when the Human asks for work." />
        </SettingsCard>
      ) : (
        flow.lanes.map((entry) => lane(entry))
      )}

      {flow.asks.length > 0 ? (
        <SettingsCard>
          <View style={styles.row}>
            <View style={styles.rowLabels}>
              <Text style={styles.title}>Open asks</Text>
              <Text style={styles.hint}>Each one is repeated in every letter until it is answered.</Text>
            </View>
            <Text style={styles.trailing}>{`${flow.asks.length} open`}</Text>
          </View>
          {flow.asks.map((entry) => ask(entry))}
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
