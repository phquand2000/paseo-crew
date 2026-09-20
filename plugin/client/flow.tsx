import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { memo, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Empty } from "./bits.tsx";
import { type FlowLane, type FlowSeat, type FlowView, type WatchSeat, type WatchView, countsInstead } from "./data.ts";

type Props = {
  /** False on the machine screen, where there is no project to follow and nothing is read. */
  following: boolean;
  flow: FlowView | null;
  error: string | null;
  live: boolean;
  theme: PluginTheme;
  disabled: boolean;
  onLive(live: boolean): void;
  onOpen(lane: string): void;
};

const NODE_W = 232;
const NODE_H = 80;
const COL_GAP = 44;
const ROW_GAP = 12;
const PAD = 16;

const ago = (minutes: number): string => (minutes < 1 ? "just now" : `${minutes} min`);
/** The whole phrase, because "just now" is not a duration and read as "handed back just now ago". */
const since = (minutes: number): string => (minutes < 1 ? "just now" : `${minutes} min ago`);

const seatText = (seat: FlowSeat | null): string => {
  if (!seat) return "no seat";
  if (seat.waiting.length > 0) return `waiting on you · ${seat.waiting[0]}`;
  if (seat.status === "gone") return seat.minutes > 0 ? `gone · last heard ${seat.minutes} min ago` : "gone";
  return `${seat.status} · ${ago(seat.minutes)}`;
};

function useStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      canvas: { borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface0, overflow: "hidden" as const },
      node: { width: NODE_W, height: NODE_H, gap: 4, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2 },
      head: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      title: { flex: 1, color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
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
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
      labels: { flex: 1, gap: 4 },
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
  return (
    <View style={styles.lane}>
      <Node
        theme={theme}
        title={`Lead · ${lane.id} ${lane.title}`}
        hint={`${lane.branch} off ${lane.base}`}
        state={countsInstead(lane) ? `${lane.taskCount} task${lane.taskCount === 1 ? "" : "s"}, ${lane.running} running` : seatText(lane.lead)}
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
                  state={task.handback !== null ? `${task.status} · handed back ${since(task.handback)}` : `${task.status} · ${seatText(task.peer)}`}
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

/** Money, to the tenth of a cent, because a watch of a whole lane costs about one cent in total. */
const spent = (cost: number): string => (cost === 0 ? "nothing yet" : cost < 0.01 ? `${(cost * 100).toFixed(2)}¢` : `$${cost.toFixed(4)}`);

const readingText = (seat: WatchSeat): string => {
  if (seat.readings === 0) return seat.running ? "working; nothing read yet" : "nothing read yet";
  const last = seat.minutes < 1 ? "just now" : `${seat.minutes} min ago`;
  return `${seat.readings} reading${seat.readings === 1 ? "" : "s"} · ${spent(seat.cost)} · last ${last}`;
};

/**
 * Trouble nobody is mailed about. A call the harness refused is not something the watch found — it is
 * read at every turn's end whatever the switch says — so it is shown with the watch off as well.
 */
const Trouble = memo(function Trouble({ watch, theme }: { watch: WatchView; theme: PluginTheme }) {
  const styles = useStyles(theme);
  return (
    <>
      {watch.trouble.map((entry, index) => (
        <View key={`${entry.kind}-${index}`}>
          <View style={styles.line} />
          <View style={styles.row}>
            <View style={styles.labels}>
              <Text style={styles.title}>{entry.kind === "call.malformed" ? "A call never reached the desk" : "The sensor did not answer"}</Text>
              <Text style={styles.hint}>{entry.detail}</Text>
            </View>
            <Text style={styles.quiet}>{entry.minutes < 1 ? "just now" : `${entry.minutes} min`}</Text>
          </View>
        </View>
      ))}
    </>
  );
});

const Watch = memo(function Watch({ watch, theme }: { watch: WatchView; theme: PluginTheme }) {
  const styles = useStyles(theme);
  const readings = watch.seats.reduce((sum, seat) => sum + seat.readings, 0);
  const cost = watch.seats.reduce((sum, seat) => sum + seat.cost, 0);
  if (!watch.on) {
    return (
      <SettingsCard>
        <Empty theme={theme} title="The watch is off" body="It runs on a sensor key, and there is none set. Add one under Machine defaults · Team · Watch, and the seats here are followed from the next round." />
        <Trouble watch={watch} theme={theme} />
      </SettingsCard>
    );
  }
  return (
    <SettingsCard>
      <View style={styles.row}>
        <View style={styles.labels}>
          {/* Zero gets its own words. "Watching 0 seats" is the normal state right after the key goes
              in, and it reads as broken rather than as idle. */}
          <Text style={styles.title}>{watch.seats.length === 0 ? "The watch is on" : `Watching ${watch.seats.length} seat${watch.seats.length === 1 ? "" : "s"}`}</Text>
          <Text style={styles.hint}>
            {watch.seats.length === 0
              ? "No Lead or Peer is running, so there is nothing to follow yet."
              : watch.telling
                ? "Incidents are mailed to the Supervisor."
                : "Nothing it marks is mailed."}
          </Text>
        </View>
        {watch.seats.length === 0 ? null : (
          <Text style={watch.seats.some((seat) => seat.running) ? styles.alive : styles.quiet}>{`${readings} read · ${spent(cost)}`}</Text>
        )}
      </View>
      {watch.seats.map((seat) => (
        <View key={seat.id}>
          <View style={styles.line} />
          <View style={styles.row}>
            <View style={styles.labels}>
              <Text style={styles.title} numberOfLines={1}>{`${seat.role} · ${seat.id.slice(0, 8)}`}</Text>
              <Text style={styles.hint} numberOfLines={1}>{readingText(seat)}</Text>
            </View>
            <Text style={seat.running ? styles.alive : styles.quiet} numberOfLines={1}>
              {seat.highest ? `${seat.highest.question} ${seat.highest.p.toFixed(2)}` : seat.running ? "running" : "idle"}
            </Text>
          </View>
        </View>
      ))}
      <View style={styles.line} />
      <SettingsRow
        label={`${watch.incidents.open} open incident${watch.incidents.open === 1 ? "" : "s"}`}
        hint={
          watch.incidents.held > 0
            ? `${watch.incidents.held} of them held back, waiting on the sensor, a day's budget, or Mail incidents to the Supervisor being off. The Supervisor lists them with \`incidents\`.`
            : "The Supervisor lists them with `incidents` and marks each one useful, noise or unknown."
        }
      />
      <Trouble watch={watch} theme={theme} />
    </SettingsCard>
  );
});

export function FlowSection({ following, flow, error, live, theme, disabled, onLive, onOpen }: Props) {
  const styles = useStyles(theme);
  const empty = flow !== null && flow.lanes.length === 0 && flow.supervisors.length === 0;

  return (
    <SettingsSection title="Flow" info="Only what the team is holding right now. Open a lane to see its Peers.">
      <SettingsCard>
        <SettingsSwitch
          label="Follow the team live"
          hint={!following ? "The default every project starts with. A project's own Flow tab is what reads its ledger." : live ? "Reads the ledger every few seconds while this tab is open." : "Switched off, so this tab costs nothing."}
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
          <Empty theme={theme} title={following ? "Reading the ledger" : "Flow follows one project"} body={following ? "This refreshes on its own." : "Open a project to watch its lanes; the switch above only sets the default."} />
        </SettingsCard>
      ) : empty ? (
        <SettingsCard>
          <Empty theme={theme} title="Nothing is running" body="Open a lane and its Lead, Peers and asks appear here." />
        </SettingsCard>
      ) : (
        <View style={styles.canvas}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ paddingBottom: PAD }}>
              {flow.supervisors.map((seat) => (
                <View key={seat.id} style={styles.lane}>
                  <Node theme={theme} title={seat.role === "supervisor" ? "Supervisor" : `Supervisor · ${seat.role}`} hint={seat.id} state={seatText(seat)} alive={seat.status !== "gone"} />
                </View>
              ))}
              {flow.lanes.map((lane) => (
                <Lane key={lane.id} lane={lane} theme={theme} onOpen={onOpen} />
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {live && flow && flow.moreLanes > 0 ? (
        <SettingsCard>
          <SettingsRow
            label={`${flow.moreLanes} more lane${flow.moreLanes === 1 ? "" : "s"}`}
            hint={`This screen draws the first ${flow.lanes.length} open lanes and no more. The rest are running; the status page lists every one of them.`}
          />
        </SettingsCard>
      ) : null}

      {live && flow && flow.watch ? <Watch watch={flow.watch} theme={theme} /> : null}

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
