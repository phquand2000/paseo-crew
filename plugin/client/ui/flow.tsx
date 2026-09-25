import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { memo, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Button, Empty } from "./bits.tsx";
import type { FlowAsk, FlowLane, FlowSeat, FlowTask, FlowView } from "../../shared/views.ts";
import { countsInstead } from "../format/flow.ts";
import { ApprovalsCards } from "./approvals.tsx";
import { QuestionCards } from "./questions.tsx";
import { WatchCard } from "./watching.tsx";

/** Paseo's own navigation, absent on older hosts: every place that opens something hides without it. */
type Navigation = PluginSurfaceProps["navigation"];

type Props = {
  following: boolean;
  flow: FlowView | null;
  error: string | null;
  live: boolean;
  theme: PluginTheme;
  disabled: boolean;
  onLive(live: boolean): void;
  onOpen(lane: string): void;
  navigation: Navigation;
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
    }),
    [theme],
  );
}

/** A seat's chat in Paseo, where the Human answers it themselves; nothing when the seat is gone or the host cannot open one. */
const chatOf = (navigation: Navigation, seat: FlowSeat | null) => (navigation && seat && seat.status !== "gone" ? () => navigation.openAgent({ agentId: seat.id }) : undefined);

const Node = memo(function Node({ title, hint, state, alive, caret, theme, onPress, onChat }: {
  title: string;
  hint: string;
  state: string;
  alive: boolean;
  caret?: string;
  theme: PluginTheme;
  onPress?: () => void;
  onChat?: () => void;
}) {
  const styles = useStyles(theme);
  return (
    <Pressable accessibilityRole={onPress ? "button" : "text"} accessibilityLabel={title} disabled={!onPress} onPress={onPress} style={styles.node}>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {caret ? <Text style={styles.caret}>{caret}</Text> : null}
        {onChat ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title} in Paseo`} hitSlop={8} onPress={onChat}>
            <Text style={styles.caret}>›</Text>
          </Pressable>
        ) : null}
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

/** Where a lane works: the Human's own checkout, or a copy of its own. */
const where = (lane: FlowLane): string => (lane.copy ? `copy ${lane.copy}` : "your checkout");

/** What a task's card says of it: why it cannot start or merge yet, what a waiting one waits for, since when a handed-back one waits, else what its seat is doing. */
const taskState = (task: FlowTask): string => {
  if (task.held) return `${task.status}: ${task.held}`;
  if (task.status === "waiting") return task.after.length > 0 ? `waiting on ${task.after.join(", ")}` : "waiting";
  if (task.handback !== null) return `${task.status} · handed back ${since(task.handback)}`;
  return `${task.status} · ${seatText(task.peer)}`;
};

/** What a lane's Lead card says of it: the Human's part first, then a hold, a READY, and what is running. */
const leadState = (lane: FlowLane): string => {
  if (lane.landApproval) return lane.landApproval.approved ? "landing approved, not landed yet" : "landing waits for your approval";
  if (lane.onHold) return `on hold ${ago(lane.onHold.minutes)}: ${lane.onHold.reason}`;
  if (lane.ready !== undefined) return `reported ready ${since(lane.ready)}`;
  return countsInstead(lane) ? `${lane.taskCount} task${lane.taskCount === 1 ? "" : "s"}, ${lane.running} running` : seatText(lane.lead);
};

type LaneProps = { lane: FlowLane; theme: PluginTheme; navigation: Navigation };

/** A closed lane's Lead the Supervisor has not released yet, kept for more work with any copy of its own. */
function KeptLead({ lane, theme, navigation }: LaneProps) {
  const styles = useStyles(theme);
  return (
    <View style={styles.lane}>
      <Node
        theme={theme}
        title={`Kept Lead · ${lane.id} ${lane.title}`}
        hint={`${lane.landed ? "landed" : "dropped"}${lane.copy ? ` · keeps copy ${lane.copy}` : ""} · until released`}
        state={seatText(lane.lead)}
        alive={Boolean(lane.lead && lane.lead.status !== "gone")}
        onChat={chatOf(navigation, lane.lead)}
      />
    </View>
  );
}

/** An open lane's seats below its Lead: each task's, then each Peer kept idle after its task until released. */
function Peers({ lane, theme, navigation }: LaneProps) {
  const styles = useStyles(theme);
  return (
    <>
      <View style={styles.spine} />
      <View style={styles.rail} />
      <View style={styles.children}>
        {lane.tasks.map((task) => (
          <View key={task.id} style={styles.stub}>
            <View style={styles.link} />
            <Node
              theme={theme}
              title={`${task.kind === "review" ? "Reviewer" : "Peer"} · ${task.id}${task.mode === "parallel" ? " · parallel" : ""}`}
              hint={task.copy ? `${task.copy} · ${task.title}` : task.title}
              state={taskState(task)}
              alive={task.status === "running" || task.status === "rework"}
              onChat={chatOf(navigation, task.peer)}
            />
          </View>
        ))}
        {lane.kept.map((seat) => (
          <View key={seat.id} style={styles.stub}>
            <View style={styles.link} />
            <Node theme={theme} title={`Peer · kept · ${seat.task}`} hint="stays until its Lead releases it" state={seatText(seat)} alive={false} onChat={chatOf(navigation, seat)} />
          </View>
        ))}
      </View>
    </>
  );
}

const Lane = memo(function Lane({ lane, theme, onOpen, navigation }: LaneProps & { onOpen(id: string): void }) {
  const styles = useStyles(theme);
  if (lane.status === "closed") return <KeptLead lane={lane} theme={theme} navigation={navigation} />;
  if (lane.status === "waiting") {
    return (
      <View style={styles.lane}>
        <Node theme={theme} title={`Waiting · ${lane.id} ${lane.title}`} hint={`after ${(lane.after ?? []).join(", ")}`} state={lane.held ? `not open: ${lane.held}` : "opens once those land"} alive={false} />
      </View>
    );
  }
  const opens = lane.taskCount > 0 || lane.kept.length > 0;
  return (
    <View style={styles.lane}>
      <View style={{ gap: 8 }}>
        <Node
          theme={theme}
          title={`Lead · ${lane.id} ${lane.title}`}
          hint={`${where(lane)} · ${lane.base ? `${lane.branch} off ${lane.base}` : `${lane.branch}, carried on in place`}`}
          state={leadState(lane)}
          alive={Boolean(lane.lead && lane.lead.status !== "gone" && !lane.onHold)}
          caret={opens ? (lane.open ? "▾" : "▸") : undefined}
          onPress={opens ? () => onOpen(lane.id) : undefined}
          onChat={chatOf(navigation, lane.lead)}
        />
        {navigation && lane.workspaceId && lane.open ? <Button label={`Open ${lane.id}'s diff`} theme={theme} onPress={() => navigation.openWorkspace({ workspaceId: lane.workspaceId! })} /> : null}
      </View>
      {lane.open && (lane.tasks.length > 0 || lane.kept.length > 0) ? <Peers lane={lane} theme={theme} navigation={navigation} /> : null}
    </View>
  );
});

/** The asks still open between seats, which the Human only reads: answering them is the seats' own work. */
function AsksCard({ asks, theme }: { asks: FlowAsk[]; theme: PluginTheme }) {
  const styles = useStyles(theme);
  return (
    <SettingsCard>
      {asks.map((ask) => (
        <View key={ask.id} style={styles.row}>
          <View style={styles.labels}>
            <Text style={styles.title}>{`${ask.id} · ${ask.text}`}</Text>
            <Text style={styles.hint}>{`${ask.kind} from the ${ask.fromRole}`}</Text>
          </View>
          <Text style={styles.quiet}>{ago(ask.minutes)}</Text>
        </View>
      ))}
    </SettingsCard>
  );
}

export function FlowSection({ following, flow, error, live, theme, disabled, onLive, onOpen, navigation }: Props) {
  const styles = useStyles(theme);
  const empty = flow !== null && flow.lanes.length === 0 && flow.supervisors.length === 0;

  return (
    <SettingsSection title="Flow" info="Only what the team is holding right now, seats kept until their superior releases them included. Open a lane to see its Peers.">
      <SettingsCard>
        <SettingsSwitch
          label="Follow the team live"
          hint={!following ? "The default every project starts with. A project's own Flow tab is what reads its ledger." : live ? "Reads the ledger every few seconds while this tab is open." : "Switched off, so this tab costs nothing."}
          value={live}
          onValueChange={onLive}
          disabled={disabled}
        />
      </SettingsCard>

      {live && flow ? <QuestionCards project={flow.project} questions={flow.questions} theme={theme} /> : null}
      {live && flow ? <ApprovalsCards project={flow.project} lanes={flow.lanes} theme={theme} /> : null}

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
                  <Node theme={theme} title={seat.role === "supervisor" ? "Supervisor" : `Supervisor · ${seat.role}`} hint={seat.id} state={seatText(seat)} alive={seat.status !== "gone"} onChat={chatOf(navigation, seat)} />
                </View>
              ))}
              {flow.lanes.map((lane) => (
                <Lane key={lane.id} lane={lane} theme={theme} onOpen={onOpen} navigation={navigation} />
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {live && flow && flow.moreLanes > 0 ? (
        <SettingsCard>
          <SettingsRow
            label={`${flow.moreLanes} more lane${flow.moreLanes === 1 ? "" : "s"}`}
            hint={`This screen draws the first ${flow.lanes.length} lanes and no more. The rest are open, waiting, or closed with their Lead kept; the status page lists every one of them.`}
          />
        </SettingsCard>
      ) : null}

      {live && flow ? <WatchCard watch={flow.watch} theme={theme} /> : null}

      {live && flow && flow.asks.length > 0 ? <AsksCard asks={flow.asks} theme={theme} /> : null}
    </SettingsSection>
  );
}
