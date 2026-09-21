import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard } from "@getpaseo/plugin/client/ui";
import { Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { memo, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Cell, Dot, Heading, Help, Rule, Stats, Tag } from "./bits.tsx";
import {
  type IncidentFilter,
  type KindGroup,
  type LaneGroup,
  type SeatFilter,
  type WatchIncident,
  type WatchSeat,
  type WatchView,
  heldText,
  incidentCounts,
  kindGroups,
  laneGroups,
  marksOf,
  seatCounts,
  spent,
  watchCard,
} from "./data.ts";
import { TabBar } from "./tabs.tsx";

/** Below this the table's number columns fold into each seat's second line; a phone is about 380. */
const WIDE = 560;
/** A lane shows this many seats until it is opened in full. */
const FIRST = 5;
/** The seat list and the incident list scroll inside the card past these, so the card keeps one size. */
const SEATS_TALL = 380;
const INCIDENTS_TALL = 480;
const COL = { reads: 72, spent: 80, signal: 180 };

const ago = (minutes: number): string => (minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`);

function useStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 18, paddingVertical: 14 },
      labels: { flex: 1, gap: 4, minWidth: 0 },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12 },
      small: { color: theme.colors.foreground, fontSize: 13 },
      id: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const, opacity: 0.7 },
      live: { color: theme.colors.statusSuccess, fontSize: 12, fontWeight: "500" as const },
      pad: { paddingHorizontal: 18, paddingBottom: 14 },
      toolbar: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, flexWrap: "wrap" as const, gap: 8, paddingHorizontal: 18, paddingBottom: 12 },
      columns: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingLeft: 38, paddingRight: 18, paddingVertical: 8 },
      column: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const, letterSpacing: 0.6 },
      link: { color: theme.colors.foreground, fontSize: 12, fontWeight: "500" as const },
      caret: { width: 12, color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [theme],
  );
}

type Colors = PluginTheme["colors"];
const levelColor = (colors: Colors, level: "page" | "attend") => (level === "page" ? colors.statusDanger : colors.statusWarning);
const markColor = (colors: Colors, mark: string) => (/useful/.test(mark) ? colors.statusSuccess : /open/.test(mark) ? colors.statusWarning : colors.foregroundMuted);

/** One incident as a row: what was seen, on whom, and where it has got to. */
const IncidentRow = memo(function IncidentRow({ item, theme }: { item: WatchIncident; theme: PluginTheme }) {
  const styles = useStyles(theme);
  const c = theme.colors;
  const state = item.open ? (item.told ? "told" : heldText(item.held)) : (item.label ?? "unknown");
  return (
    <View style={styles.row}>
      <Dot color={levelColor(c, item.level)} />
      <View style={styles.labels}>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.hint} numberOfLines={1}>{[item.where, item.note || ago(item.minutes)].join(" · ")}</Text>
      </View>
      {item.open ? <Tag text={item.level} color={levelColor(c, item.level)} theme={theme} /> : null}
      <Tag text={state} color={item.label === "useful" ? c.statusSuccess : c.foreground} theme={theme} />
      <Text style={styles.id}>{item.id}</Text>
    </View>
  );
});

/** A seat as a table row. Narrow, its numbers move under its name instead of into columns. */
const SeatRow = memo(function SeatRow({ seat, wide, theme }: { seat: WatchSeat; wide: boolean; theme: PluginTheme }) {
  const styles = useStyles(theme);
  const c = theme.colors;
  const name = `${seat.task ? "Peer" : "Lead"} · ${seat.task ? `${seat.task.id} ${seat.task.title}` : (seat.lane?.id ?? seat.id.slice(0, 8))}`;
  const signal = seat.signal ? `${seat.signal.label}${seat.signal.p !== null ? ` ${seat.signal.p.toFixed(2)}` : ""}` : seat.running ? "—" : "idle";
  const signalColor = seat.signal ? levelColor(c, seat.signal.level) : c.foregroundMuted;
  return (
    <View style={[styles.row, { paddingVertical: 8, paddingLeft: 38 }]}>
      <Dot color={seat.running ? c.statusSuccess : c.foregroundMuted} size={6} />
      <View style={styles.labels}>
        <Text style={styles.small} numberOfLines={1}>{name}</Text>
        {wide ? null : <Text style={[styles.hint, { color: signalColor }]} numberOfLines={1}>{`${seat.readings} readings · ${spent(seat.cost)} · ${signal}`}</Text>}
      </View>
      {wide ? (
        <>
          <Cell text={String(seat.readings)} width={COL.reads} color={c.foregroundMuted} />
          <Cell text={spent(seat.cost)} width={COL.spent} color={c.foregroundMuted} />
          <Cell text={signal} width={COL.signal} color={signalColor} strong={Boolean(seat.signal)} />
        </>
      ) : null}
    </View>
  );
});

function Lane({ lane, open, full, wide, theme, onOpen, onFull }: { lane: LaneGroup; open: boolean; full: boolean; wide: boolean; theme: PluginTheme; onOpen(): void; onFull(): void }) {
  const styles = useStyles(theme);
  const c = theme.colors;
  const who = [lane.leads > 0 ? "Lead" : "", lane.peers > 0 ? `${lane.peers} Peer${lane.peers === 1 ? "" : "s"}` : ""].filter(Boolean).join(" + ");
  const flag = lane.flagged > 0 ? `${lane.flagged} flagged` : "—";
  const shown = full ? lane.seats : lane.seats.slice(0, FIRST);
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${lane.id} ${lane.title}`} onPress={onOpen} style={[styles.row, { paddingVertical: 12, gap: 8 }]}>
        <Text style={styles.caret}>{open ? "▾" : "▸"}</Text>
        <View style={styles.labels}>
          <Text style={styles.title} numberOfLines={1}>{lane.id ? `${lane.id} · ${lane.title}` : lane.title}</Text>
          <Text style={styles.hint} numberOfLines={1}>{`${who} · ${lane.running} running${wide || lane.flagged === 0 ? "" : ` · ${flag}`}`}</Text>
        </View>
        {wide ? (
          <>
            <Cell text="" width={COL.reads} color={c.foregroundMuted} />
            <Cell text={spent(lane.cost)} width={COL.spent} color={c.foreground} strong />
            <Cell text={flag} width={COL.signal} color={lane.flagged > 0 ? c.statusWarning : c.foregroundMuted} strong={lane.flagged > 0} />
          </>
        ) : null}
      </Pressable>
      {open ? shown.map((seat) => <SeatRow key={seat.id} seat={seat} wide={wide} theme={theme} />) : null}
      {open && lane.seats.length > FIRST ? (
        <View style={[styles.row, { paddingTop: 4, paddingBottom: 12, paddingLeft: 38, gap: 6 }]}>
          {full ? null : <Text style={styles.hint}>{`${lane.seats.length - FIRST} more in ${lane.id || "this group"} ·`}</Text>}
          <Pressable accessibilityRole="button" onPress={onFull}>
            <Text style={styles.link}>{full ? "Show fewer" : `Show all ${lane.seats.length}`}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Seats({ seats, theme }: { seats: WatchSeat[]; theme: PluginTheme }) {
  const styles = useStyles(theme);
  const c = theme.colors;
  const [filter, setFilter] = useState<SeatFilter>("all");
  const [width, setWidth] = useState(0);
  // Only what the owner opened or closed is remembered; every other lane follows the rule, so one
  // that turns flagged while the tab is open opens itself.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [full, setFull] = useState<Record<string, boolean>>({});
  const counts = seatCounts(seats);
  const lanes = laneGroups(seats, filter);
  const wide = width === 0 || width >= WIDE;
  const tabs: { id: SeatFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "flagged", label: "Flagged", count: counts.flagged },
    { id: "running", label: "Running", count: counts.running },
    { id: "idle", label: "Idle", count: counts.idle },
  ];
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={styles.toolbar}>
        <TabBar tabs={tabs} active={filter} theme={theme} onPick={(id) => setFilter(id as SeatFilter)} />
        <Text style={styles.hint}>Flagged first</Text>
      </View>
      <Rule theme={theme} />
      {wide ? (
        <View style={styles.columns}>
          <Text style={[styles.column, { flex: 1 }]}>SEAT</Text>
          <Text style={[styles.column, { width: COL.reads, textAlign: "right" }]}>READINGS</Text>
          <Text style={[styles.column, { width: COL.spent, textAlign: "right" }]}>SPENT</Text>
          <Text style={[styles.column, { width: COL.signal, textAlign: "right" }]}>SIGNAL</Text>
        </View>
      ) : null}
      <ScrollView style={{ maxHeight: SEATS_TALL }} nestedScrollEnabled showsVerticalScrollIndicator>
        {lanes.length === 0 ? <Text style={[styles.hint, styles.pad, { paddingTop: 12 }]}>No seat is in this view.</Text> : null}
        {lanes.map((lane, index) => {
          const open = toggled[lane.id] ?? (lane.flagged > 0 || lanes.length === 1);
          return (
            <View key={lane.id}>
              {index > 0 ? <Rule theme={theme} /> : null}
              <Lane
                lane={lane}
                open={open}
                full={Boolean(full[lane.id])}
                wide={wide}
                theme={theme}
                onOpen={() => setToggled((current) => ({ ...current, [lane.id]: !open }))}
                onFull={() => setFull((current) => ({ ...current, [lane.id]: !current[lane.id] }))}
              />
            </View>
          );
        })}
      </ScrollView>
      <Rule theme={theme} />
      <View style={[styles.row, { paddingVertical: 10, justifyContent: "space-between" }]}>
        <Text style={styles.hint}>{lanes.length > 1 ? "Scroll for the rest of the lanes" : " "}</Text>
        <Text style={[styles.hint, { color: c.foreground, fontWeight: "500" }]}>{`Total ${spent(seats.reduce((sum, seat) => sum + seat.cost, 0))}`}</Text>
      </View>
    </View>
  );
}

/** A kind of incident as a table row. Narrow, its counts move under its name instead of into columns. */
function KindRow({ group, open, wide, theme, onOpen }: { group: KindGroup; open: boolean; wide: boolean; theme: PluginTheme; onOpen(): void }) {
  const styles = useStyles(theme);
  const c = theme.colors;
  const marks = marksOf(group);
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={group.title} onPress={onOpen} style={[styles.row, { paddingVertical: 12 }]}>
        <Text style={styles.caret}>{open ? "▾" : "▸"}</Text>
        <Dot color={levelColor(c, group.level)} />
        <View style={styles.labels}>
          <Text style={styles.title} numberOfLines={1}>{group.title}</Text>
          <Text style={styles.hint} numberOfLines={1}>{group.wheres.join(", ")}</Text>
          {wide ? null : <Text style={[styles.hint, { color: markColor(c, marks) }]} numberOfLines={1}>{`seen ${group.seen} · ${marks}`}</Text>}
        </View>
        {wide ? (
          <>
            <Cell text={String(group.seen)} width={48} color={c.foreground} strong />
            <Cell text={marks} width={140} color={markColor(c, marks)} strong />
          </>
        ) : null}
      </Pressable>
      {open
        ? group.incidents.map((item) => {
            const mark = item.open ? (item.told ? "open, told" : heldText(item.held)) : (item.label ?? "unknown");
            const markTone = item.label === "useful" ? c.statusSuccess : c.foregroundMuted;
            return (
              <View key={item.id} style={[styles.row, { paddingVertical: 8, paddingLeft: wide ? 58 : 38 }]}>
                <View style={styles.labels}>
                  <Text style={styles.small} numberOfLines={1}>{`${item.id} · ${item.where} · ${ago(item.minutes)}`}</Text>
                  {wide ? null : <Text style={[styles.hint, { color: markTone, fontWeight: "500" }]}>{mark}</Text>}
                  {item.note ? <Text style={styles.hint} numberOfLines={wide ? 2 : 3}>{item.note}</Text> : null}
                </View>
                {wide ? <Cell text={mark} width={140} color={markTone} strong /> : null}
              </View>
            );
          })
        : null}
    </View>
  );
}

function Incidents({ watch, theme, onBack }: { watch: WatchView; theme: PluginTheme; onBack(): void }) {
  const styles = useStyles(theme);
  const [filter, setFilter] = useState<IncidentFilter>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(0);
  const wide = width === 0 || width >= WIDE;
  const counts = incidentCounts(watch.incidents);
  const groups = kindGroups(watch.incidents, filter);
  const cut = watch.marks.total - watch.incidents.length;
  const tabs: { id: IncidentFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "useful", label: "Worth a look", count: counts.useful },
    { id: "noise", label: "Noise", count: counts.noise },
    { id: "unknown", label: "Unknown", count: counts.unknown },
    { id: "open", label: "Open", count: counts.open },
  ];
  return (
    <SettingsCard>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={[styles.row, { paddingBottom: 12, gap: 10 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to the watch" hitSlop={8} onPress={onBack}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 18 }}>‹</Text>
          </Pressable>
          <View style={styles.labels}>
            <Text style={styles.title}>{`${watch.marks.total} incident${watch.marks.total === 1 ? "" : "s"} here`}</Text>
            <Text style={styles.hint}>{`Grouped by what was seen. Marks are the Supervisor's, from ack.${cut > 0 ? ` The ${cut} least pressing are not listed.` : ""}`}</Text>
          </View>
        </View>
        <View style={styles.toolbar}>
          <TabBar tabs={tabs} active={filter} theme={theme} onPick={(id) => setFilter(id as IncidentFilter)} />
          <Text style={styles.hint}>Worth a look first</Text>
        </View>
        <Rule theme={theme} />
        {wide ? (
          <View style={[styles.columns, { paddingLeft: 58 }]}>
            <Text style={[styles.column, { flex: 1 }]}>WHAT WAS SEEN</Text>
            <Text style={[styles.column, { width: 48, textAlign: "right" }]}>SEEN</Text>
            <Text style={[styles.column, { width: 140, textAlign: "right" }]}>MARK</Text>
          </View>
        ) : null}
        <ScrollView style={{ maxHeight: INCIDENTS_TALL }} nestedScrollEnabled showsVerticalScrollIndicator>
          {groups.length === 0 ? <Text style={[styles.hint, styles.pad, { paddingTop: 12 }]}>Nothing in this view.</Text> : null}
          {groups.map((group, index) => (
            <View key={group.kind}>
              {index > 0 ? <Rule theme={theme} /> : null}
              <KindRow group={group} open={open[group.kind] ?? index === 0} wide={wide} theme={theme} onOpen={() => setOpen((current) => ({ ...current, [group.kind]: !(current[group.kind] ?? index === 0) }))} />
            </View>
          ))}
        </ScrollView>
      </View>
    </SettingsCard>
  );
}

const LEGEND: { section: string; items: { term: string; tone: "success" | "muted" | "warning" | "danger" | "plain"; dot?: boolean; meaning: string }[] }[] = [
  {
    section: "Seats",
    items: [
      { term: "running", tone: "success", dot: true, meaning: "Its turns are being read right now." },
      { term: "idle", tone: "muted", dot: true, meaning: "Nothing to read until it works again." },
    ],
  },
  {
    section: "Incidents",
    items: [
      { term: "page", tone: "danger", dot: true, meaning: "Irreversible — a force push, rm -rf, a dropped table. Told at once, never held back." },
      { term: "attend", tone: "warning", dot: true, meaning: "Worth a look — a seat going round in circles, work handed back with no gate run, a test that lost its assertions." },
    ],
  },
  {
    section: "Marks — the Supervisor's, from ack",
    items: [
      { term: "useful", tone: "success", meaning: "It happened, and the brief did not ask for it." },
      { term: "noise", tone: "muted", meaning: "Expected. The same words on that seat are counted, not raised again." },
      { term: "unknown", tone: "plain", meaning: "Could not be judged either way." },
    ],
  },
  {
    section: "Numbers",
    items: [
      { term: "0.81", tone: "warning", meaning: "Beside a signal: the highest one of the sensor's questions read on that seat, from 0 to 1. It is flagged once it passes that question's bar." },
      { term: "held", tone: "plain", meaning: "Recorded but not mailed yet — waiting on the sensor, past a day's budget, or with nobody seated to tell." },
      { term: "$", tone: "plain", meaning: "What the sensor charged. What the agents themselves cost is not counted here." },
    ],
  },
];

/** What the words on the card mean, behind its ?. In the host's own dialog, so it behaves on a phone. */
function Legend({ open, theme, onOpenChange }: { open: boolean; theme: PluginTheme; onOpenChange(open: boolean): void }) {
  const c = theme.colors;
  const tone = { success: c.statusSuccess, muted: c.foregroundMuted, warning: c.statusWarning, danger: c.statusDanger, plain: c.foreground };
  return (
    <Modal title="What the watch card shows" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        {LEGEND.map((part) => (
          <View key={part.section} style={{ gap: 8 }}>
            <Text style={{ color: c.foregroundMuted, fontSize: 11, fontWeight: "500", letterSpacing: 0.6, textTransform: "uppercase" }}>{part.section}</Text>
            {part.items.map((item) => (
              <View key={item.term} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                <View style={{ width: 96, flexDirection: "row", alignItems: "center", gap: 7 }}>
                  {item.dot ? <Dot color={tone[item.tone]} size={7} /> : null}
                  <Text style={{ color: tone[item.tone], fontSize: 12, fontWeight: "500" }}>{item.term}</Text>
                </View>
                <Text style={{ flex: 1, color: c.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{item.meaning}</Text>
              </View>
            ))}
          </View>
        ))}
      </Modal.Content>
    </Modal>
  );
}

/** Trouble nobody is mailed about. Shown with the watch off too: a refused call is the harness's, not the watch's. */
function Trouble({ watch, theme }: { watch: WatchView; theme: PluginTheme }) {
  const styles = useStyles(theme);
  if (watch.trouble.length === 0) return null;
  return (
    <>
      <Rule theme={theme} />
      <Heading text="Not from the watch" theme={theme} />
      {watch.trouble.map((entry, index) => (
        <View key={`${entry.kind}-${index}`} style={[styles.row, { paddingTop: 8 }]}>
          <Dot color={theme.colors.statusWarning} />
          <View style={styles.labels}>
            <Text style={styles.title}>{entry.kind === "call.malformed" ? "A call never reached the desk" : "The sensor did not answer"}</Text>
            <Text style={styles.hint}>{entry.detail}</Text>
          </View>
          <Text style={styles.hint}>{ago(entry.minutes)}</Text>
        </View>
      ))}
    </>
  );
}

/**
 * The watch, on the Flow tab: whether it runs, what it has done in this project, what needs the
 * Supervisor, the seats it is following, and what the Supervisor has settled.
 */
export function WatchCard({ watch, theme, onAddKey }: { watch: WatchView; theme: PluginTheme; onAddKey(): void }) {
  const styles = useStyles(theme);
  const c = theme.colors;
  const [legend, setLegend] = useState(false);
  const [all, setAll] = useState(false);
  const help = <Help label="What the watch card shows" theme={theme} onPress={() => setLegend(true)} />;

  if (!watch.on) {
    return (
      <SettingsCard>
        <View>
          <View style={styles.row}>
            <Dot color={c.foregroundMuted} />
            <View style={styles.labels}>
              <Text style={styles.title}>The watch is off</Text>
              <Text style={styles.hint}>It runs on a sensor key, and none is set. Nothing here is followed, read or recorded.</Text>
            </View>
            <Button label="Add a key" theme={theme} onPress={onAddKey} />
          </View>
          <Trouble watch={watch} theme={theme} />
        </View>
      </SettingsCard>
    );
  }
  if (all) return <Incidents watch={watch} theme={theme} onBack={() => setAll(false)} />;

  const card = watchCard(watch);
  const open = watch.incidents.filter((item) => item.open);
  const useful = watch.incidents.filter((item) => !item.open && item.label === "useful");
  const settled = watch.marks.noise + watch.marks.unknown;
  return (
    <SettingsCard>
      <View>
        <View style={[styles.row, { paddingBottom: 12 }]}>
          <Dot color={c.statusSuccess} />
          <View style={styles.labels}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.title}>{card.title}</Text>
              {help}
            </View>
            <Text style={styles.hint}>{card.hint}</Text>
          </View>
          {card.live ? <Text style={styles.live}>live</Text> : null}
        </View>
        <View style={styles.pad}>
          <Stats items={card.stats} theme={theme} />
        </View>

        {open.length > 0 ? (
          <>
            <Rule theme={theme} />
            <Heading text="Needs the Supervisor" tone="danger" theme={theme} />
            {open.map((item) => <IncidentRow key={item.id} item={item} theme={theme} />)}
            <Text style={[styles.hint, styles.pad]}>The Supervisor lists these with incidents and marks each useful, noise or unknown. The seat it is about never sees it.</Text>
          </>
        ) : null}

        {useful.length > 0 ? (
          <>
            <Rule theme={theme} />
            <Heading text="Worth a look" theme={theme} />
            {useful.map((item) => <IncidentRow key={item.id} item={item} theme={theme} />)}
          </>
        ) : null}

        {watch.seats.length > 0 ? (
          <>
            <Rule theme={theme} />
            <Heading text="Seats" theme={theme} />
            <Seats seats={watch.seats} theme={theme} />
          </>
        ) : null}

        <Rule theme={theme} />
        <Heading text="Settled" theme={theme} />
        <View style={[styles.row, { paddingTop: 8 }]}>
          <View style={styles.labels}>
            <Text style={styles.title}>{card.settledTitle}</Text>
            <Text style={styles.hint}>{card.settledHint}</Text>
          </View>
          {watch.marks.total > 0 ? <Button label={settled > 0 ? "Show" : "Show all"} theme={theme} onPress={() => setAll(true)} /> : null}
        </View>

        <Trouble watch={watch} theme={theme} />
        <Legend open={legend} theme={theme} onOpenChange={setLegend} />
      </View>
    </SettingsCard>
  );
}
