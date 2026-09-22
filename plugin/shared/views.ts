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

/** Something Clean up found that nothing uses any more. `held` says why it stays even if chosen. */
export type CleanItem = {
  path: string;
  kind: "seat" | "copy" | "records" | "snapshot" | "backup";
  why: string;
  bytes: number;
  /** Removed only when the owner picks it: it holds something of theirs, such as a CONTEXT.md. */
  careful: boolean;
  held: string | null;
};
export type CleanView = { items: CleanItem[]; removed: string[]; failed: { path: string; error: string }[] };

export type UpdateCommit = { sha: string; subject: string };
/** Where this checkout stands against the branch it follows, after a fetch. */
export type UpdateView = {
  dir: string;
  /** The version its package.json names. */
  version: string;
  /** The version the branch it follows names, once fetched. */
  next: string | null;
  head: string;
  /** The day its commit was made. */
  date: string | null;
  /** Whether the remote was asked just now; otherwise behind counts what the last fetch saw. */
  fetched: boolean;
  branch: string | null;
  upstream: string | null;
  behind: number;
  ahead: number;
  commits: UpdateCommit[];
  /** package.json or its lockfile moves, so the update runs `npm install`. */
  installs: boolean;
  /** The Paseo range the update asks for, when it differs from this one's. */
  paseo: string | null;
  /** Why it cannot update itself, when it cannot. */
  blocked: string | null;
  /** Seats still running, by project: the update waits until there are none. */
  busy: string[];
  updated: { from: string; to: string } | null;
};

export type MigrateStep = {
  kind: "settings" | "block" | "seat";
  where: string;
  what: string;
  detail: string[];
  /** Whether Migrate does it; the rest are for the owner, and say how. */
  auto: boolean;
};
/** A shipped unit that differs from what the owner last took in. Guides and records are only told about. */
export type ContentChange = {
  unit: string;
  kind: "guide" | "record" | "prompt" | "skill" | "team";
  change: "added" | "changed" | "removed";
  /** The owner keeps their own copy of it, which the change does not touch. */
  kept: boolean;
  /** Whether the version they had can still be kept: it is on record in git. */
  keepable: boolean;
};
export type MigrateView = { stamp: string; since: string; steps: MigrateStep[]; done: string[]; content: ContentChange[] };
