/**
 * The shapes the panel reads off the desk.
 *
 * Both sides declared these by hand, character for character, and the RPC contracts carry `z.json()`,
 * so the compiler never saw the two meet: a field added on one side reached the other as `any`. Types
 * only — nothing here is imported at runtime by either bundle.
 */

export type FlowSeat = { id: string; role: string; status: string; minutes: number; waiting: string[] };
export type FlowTask = { id: string; title: string; status: string; kind: string; peer: FlowSeat | null; minutes: number; handback: number | null };
export type FlowLane = { id: string; title: string; status: string; branch: string; base: string; lead: FlowSeat | null; tasks: FlowTask[]; taskCount: number; running: number; open: boolean };
export type FlowAsk = { id: string; kind: string; fromRole: string; to: string; minutes: number; text: string };
/** A question a seat's latest reading leans towards without raising it: how sure Jev is, and its bar. */
export type WatchLean = { title: string; p: number; bar: number };
export type WatchSeat = {
  id: string;
  /** "Peer · L1-T2 Clean build", "Lead · L1 Build". */
  name: string;
  running: boolean;
  lean: WatchLean | null;
};
export type WatchIncident = {
  id: string;
  /** What a person reads for the kind. */
  title: string;
  level: "page" | "attend";
  /** The seat, as `WatchSeat.name` has it. */
  name: string;
  minutes: number;
  /** The step or the fact that shows it. */
  quote: string;
  /** Who raised it: a fact the code measured, Jev, or a Watcher seat. */
  source: "code" | "jev" | "watcher";
  /** How sure Jev was of one it raised, and the bar that raised it. */
  sure: { p: number; bar: number } | null;
  /** Who was told, once it has been. */
  told: "lead" | "supervisor" | null;
  lane: string | null;
  /** Why it has not been told yet: shadow, awaiting, vetoed, budget or nobody. */
  held: string | null;
};
/** The Watcher seat, by a seat: whether it is running, and how many readings wait for it. */
export type WatcherSeat = { id: string; status: string; minutes: number; queued: number };
export type WatchView = {
  by: "seat" | "jev";
  /** Seats are followed: always by a seat, by Jev only with a key. */
  on: boolean;
  keyed: boolean;
  telling: boolean;
  /** How long a fact waits for its reader's second look before it is told anyway. */
  judgeMinutes: number;
  /** Set when Jev's last failure is newer than its last answer. */
  failing: { minutes: number; detail: string } | null;
  watcher: WatcherSeat | null;
  lanes: number;
  /** Live, and empty whenever no Lead or Peer is running — which is most of the time. */
  seats: WatchSeat[];
  /** Minutes since Jev last read a turn in this project; null if it never has. */
  lastRead: number | null;
  /** Every reading kept in this project, and what Jev charged for them. */
  read: { turns: number; cost: number };
  marks: { total: number; open: number; useful: number; noise: number; unknown: number };
  /** Open incidents, the most pressing first. */
  incidents: WatchIncident[];
  trouble: { kind: string; minutes: number; detail: string }[];
};
export type FlowView = { project: string; at: number; revision: string; supervisors: FlowSeat[]; lanes: FlowLane[]; moreLanes: number; asks: FlowAsk[]; watch: WatchView };
export type Check = { id: string; ok: boolean; detail: string };
