import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { memo, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Empty } from "./bits.tsx";
import type { FlowLane, FlowSeat, FlowView } from "./data.ts";

type Props = {
  flow: FlowView | null;
  error: string | null;
  live: boolean;
  open: string[];
  theme: PluginTheme;
  disabled: boolean;
  onLive(live: boolean): void;
  onOpen(lane: string): void;
};

const NODE_W = 232;
const NODE_H = 68;
const COL_GAP = 44;
const ROW_GAP = 12;
const PAD = 16;

const ago = (minutes: number): string => (minutes < 1 ? "just now" : `${minutes} min`);

const seatText = (seat: FlowSeat | null): string => {
  if (!seat) return "no seat";
  if (seat.waiting.length > 0) return `waiting on you · ${seat.waiting[0]}`;
  return `${seat.status} · ${ago(seat.minutes)}`;
};

function useStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      canvas: { borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface0, overflow: "hidden" as const },
      node: { width: NODE_W, height: NODE_H, gap: 3, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2 },
      head: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      title: { flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "500" as const },
      caret: { color: theme.colors.foregroundMuted, fontSize: 12 },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12 },
      alive: { color: theme.colors.statusSuccess, fontSize: 12, fontWeight: "500" as const },
      quiet: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const },
      lane: { flexDirection: "row" as const, paddingHorizontal: PAD, paddingTop: PAD, gap: 0 },
      children: { gap: ROW_GAP },
      stub: { flexDirection: "row" as const, alignItems: "center" as const },
      rail: { width: 1, backgroundColor: theme.colors.border },
      link: { width: COL_GAP / 2, height: 1, backgroundColor: theme.colors.border },
      spine: { width: COL_GAP / 2, height: 1, backgroundColor: theme.colors.border, alignSelf: "center" as const },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
      labels: { flex: 1, gap: 3 },
      line: { height: 1, backgroundColor: theme.colors.border },
    }),
    [theme],
  );
}

const Node = memo(function Node({ title, hint, state, alive, caret, theme, onPress }: {
  title: string;
  hint: string;
  state: string;
  alive: boolean;
  caret?: string;
  theme: PluginTheme;
  onPress?: () => void;
}) {
  const styles = useStyles(theme);
  return (
    <Pressable accessibilityRole={onPress ? "button" : "text"} accessibilityLabel={title} disabled={!onPress} onPress={onPress} style={styles.node}>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {caret ? <Text style={styles.caret}>{caret}</Text> : null}
      </View>
      <Text style={styles.hint} numberOfLines={1}>
        {hint}
      </Text>
      <Text style={alive ? styles.alive : styles.quiet} numberOfLines={1}>
        {state}
      </Text>
    </Pressable>
  );
});

const Lane = memo(function Lane({ lane, theme, onOpen }: { lane: FlowLane; theme: PluginTheme; onOpen(id: string): void }) {
  const styles = useStyles(theme);
  const shut = lane.taskCount > 0 && !lane.open;
  return (
    <View style={styles.lane}>
      <Node
        theme={theme}
        title={`Lead · ${lane.id} ${lane.title}`}
        hint={`${lane.branch} off ${lane.base}`}
        state={shut ? `${lane.taskCount} task${lane.taskCount === 1 ? "" : "s"}, ${lane.running} running` : seatText(lane.lead)}
        alive={Boolean(lane.lead && lane.lead.status !== "gone")}
        caret={lane.taskCount === 0 ? undefined : lane.open ? "▾" : "▸"}
        onPress={lane.taskCount === 0 ? undefined : () => onOpen(lane.id)}
      />
      {lane.open && lane.tasks.length > 0 ? (
        <>
          <View style={styles.spine} />
          <View style={styles.rail} />
          <View style={styles.children}>
            {lane.tasks.map((task) => (
              <View key={task.id} style={styles.stub}>
                <View style={styles.link} />
                <Node
                  theme={theme}
                  title={`${task.kind === "review" ? "Reviewer" : "Peer"} · ${task.id}`}
                  hint={task.title}
                  state={task.handback !== null ? `${task.status} · handed back ${ago(task.handback)} ago` : `${task.status} · ${seatText(task.peer)}`}
                  alive={task.status === "running" || task.status === "rework"}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
});

export function FlowSection({ flow, error, live, theme, disabled, onLive, onOpen }: Props) {
  const styles = useStyles(theme);
  const empty = flow !== null && flow.lanes.length === 0 && flow.supervisor === null;

  return (
    <SettingsSection title="Flow" info="Only what the team is holding right now. Open a lane to see its Peers.">
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
        <View style={styles.canvas}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ paddingBottom: PAD }}>
              {flow.supervisor ? (
                <View style={styles.lane}>
                  <Node theme={theme} title="Supervisor" hint={flow.supervisor.id} state={seatText(flow.supervisor)} alive={flow.supervisor.status !== "gone"} />
                </View>
              ) : null}
              {flow.lanes.map((lane) => (
                <Lane key={lane.id} lane={lane} theme={theme} onOpen={onOpen} />
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {live && flow && flow.moreLanes > 0 ? (
        <SettingsCard>
          <SettingsRow label={`${flow.moreLanes} more lane${flow.moreLanes === 1 ? "" : "s"}`} hint="Close a lane to bring the rest into view." />
        </SettingsCard>
      ) : null}

      {live && flow && flow.asks.length > 0 ? (
        <SettingsCard>
          {flow.asks.map((ask, index) => (
            <View key={ask.id}>
              {index > 0 ? <View style={styles.line} /> : null}
              <View style={styles.row}>
                <View style={styles.labels}>
                  <Text style={styles.title}>{`${ask.id} · ${ask.text}`}</Text>
                  <Text style={styles.hint}>{`${ask.kind} from the ${ask.fromRole}`}</Text>
                </View>
                <Text style={styles.quiet}>{ago(ask.minutes)}</Text>
              </View>
            </View>
          ))}
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
