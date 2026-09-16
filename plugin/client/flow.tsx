import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import { Empty } from "./bits.tsx";
import type { FlowLane, FlowSeat, FlowTask, FlowView } from "./data.ts";

type Props = {
  flow: FlowView | null;
  error: string | null;
  live: boolean;
  theme: PluginTheme;
  disabled: boolean;
  onLive(live: boolean): void;
};

const ago = (minutes: number): string => (minutes < 1 ? "just now" : `${minutes} min`);

const seatText = (seat: FlowSeat | null): string => {
  if (!seat) return "no seat";
  if (seat.waiting.length > 0) return `waiting on you · ${seat.waiting[0]}`;
  return `${seat.status} · ${ago(seat.minutes)}`;
};

function useStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      lane: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, gap: 10 },
      node: { gap: 4, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2 },
      name: { color: theme.colors.foreground, fontSize: 13, fontWeight: "500" as const },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12 },
      live: { color: theme.colors.statusSuccess, fontSize: 11, fontWeight: "500" as const },
      quiet: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "500" as const },
      branch: { flexDirection: "row" as const, gap: 10 },
      rail: { width: 1, backgroundColor: theme.colors.border, marginLeft: 16 },
      children: { flex: 1, gap: 8, paddingBottom: 4 },
      stub: { flexDirection: "row" as const, alignItems: "center" as const, gap: 0 },
      link: { width: 14, height: 1, backgroundColor: theme.colors.border },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
      labels: { flex: 1, gap: 3 },
      line: { height: 1, backgroundColor: theme.colors.border },
    }),
    [theme],
  );
}

const Node = memo(function Node({ title, hint, state, alive, theme }: { title: string; hint: string; state: string; alive: boolean; theme: PluginTheme }) {
  const styles = useStyles(theme);
  return (
    <View style={styles.node}>
      <Text style={styles.name}>{title}</Text>
      <Text style={styles.hint} numberOfLines={1}>
        {hint}
      </Text>
      <Text style={alive ? styles.live : styles.quiet}>{state}</Text>
    </View>
  );
});

const Lane = memo(function Lane({ lane, theme }: { lane: FlowLane; theme: PluginTheme }) {
  const styles = useStyles(theme);
  const alive = (task: FlowTask) => task.status === "running" || task.status === "rework";
  return (
    <SettingsCard>
      <View style={styles.lane}>
        <Node
          theme={theme}
          title={`Lead · ${lane.id} ${lane.title}`}
          hint={`${lane.branch} off ${lane.base}`}
          state={seatText(lane.lead)}
          alive={Boolean(lane.lead && lane.lead.status !== "gone")}
        />
        {lane.tasks.length > 0 ? (
          <View style={styles.branch}>
            <View style={styles.rail} />
            <View style={styles.children}>
              {lane.tasks.map((task) => (
                <View key={task.id} style={styles.stub}>
                  <View style={styles.link} />
                  <View style={{ flex: 1 }}>
                    <Node
                      theme={theme}
                      title={`${task.kind === "review" ? "Reviewer" : "Peer"} · ${task.id} ${task.title}`}
                      hint={task.handback !== null ? `handed back ${ago(task.handback)} ago` : seatText(task.peer)}
                      state={task.status}
                      alive={alive(task)}
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </SettingsCard>
  );
});

export function FlowSection({ flow, error, live, theme, disabled, onLive }: Props) {
  const styles = useStyles(theme);
  const empty = flow !== null && flow.lanes.length === 0 && flow.supervisor === null;

  return (
    <SettingsSection title="Flow" info="Only what the team is holding right now.">
      <SettingsCard>
        <SettingsSwitch
          label="Follow the team live"
          hint={live ? "Reads the ledger every few seconds while this tab is open." : "Switched off, so this tab costs nothing."}
          value={live}
          onValueChange={onLive}
          disabled={disabled}
        />
      </SettingsCard>

      {!live ? null : error ? (
        <SettingsCard>
          <Empty theme={theme} title="The flow could not be read" body={error} />
        </SettingsCard>
      ) : flow === null ? (
        <SettingsCard>
          <Empty theme={theme} title="Reading the ledger" body="This refreshes on its own." />
        </SettingsCard>
      ) : empty ? (
        <SettingsCard>
          <Empty theme={theme} title="Nothing is running" body="Open a lane and its Lead, Peers and asks appear here." />
        </SettingsCard>
      ) : (
        <>
          {flow.supervisor ? (
            <SettingsCard>
              <View style={styles.lane}>
                <Node theme={theme} title="Supervisor" hint={flow.supervisor.id} state={seatText(flow.supervisor)} alive={flow.supervisor.status !== "gone"} />
              </View>
            </SettingsCard>
          ) : null}
          {flow.lanes.map((lane) => (
            <Lane key={lane.id} lane={lane} theme={theme} />
          ))}
          {flow.asks.length > 0 ? (
            <SettingsCard>
              {flow.asks.map((ask, index) => (
                <View key={ask.id}>
                  {index > 0 ? <View style={styles.line} /> : null}
                  <View style={styles.row}>
                    <View style={styles.labels}>
                      <Text style={styles.name}>{`${ask.id} · ${ask.text}`}</Text>
                      <Text style={styles.hint}>{`${ask.kind} from the ${ask.fromRole}`}</Text>
                    </View>
                    <Text style={styles.quiet}>{ago(ask.minutes)}</Text>
                  </View>
                </View>
              ))}
            </SettingsCard>
          ) : null}
        </>
      )}
    </SettingsSection>
  );
}
