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
/** Something on a seat worth a look now: an incident still open on it, or a question read past its bar. */
export type WatchSignal = { label: string; p: number | null; level: "page" | "attend" };
export type WatchSeat = {
  id: string;
  role: string;
  running: boolean;
  readings: number;
  cost: number;
  minutes: number;
  /** The lane it works in, and the task when it is a Peer's; a Lead has only the lane. */
  lane: { id: string; title: string } | null;
  task: { id: string; title: string } | null;
  signal: WatchSignal | null;
};
export type WatchIncident = {
  id: string;
  kind: string;
  /** What a person reads for the kind. */
  title: string;
  level: "page" | "attend";
  where: string;
  open: boolean;
  told: boolean;
  /** Why it has not been mailed yet, while it is still open and untold. */
  held: string | null;
  label: "useful" | "noise" | "unknown" | null;
  note: string;
  count: number;
  minutes: number;
};
export type WatchView = {
  on: boolean;
  telling: boolean;
  /** Live, and empty whenever no Lead or Peer is running — which is most of the time. */
  seats: WatchSeat[];
  /** Minutes since the watch last put a turn to the sensor in this project; null if it never has. */
  lastRead: number | null;
  /** Every reading the watch has kept in this project, and what the sensor charged for them. */
  read: { turns: number; cost: number };
  marks: { total: number; open: number; held: number; useful: number; noise: number; unknown: number };
  /** Most in need of a look first; the counts in `marks` stay exact when this is cut short. */
  incidents: WatchIncident[];
  trouble: { kind: string; minutes: number; detail: string }[];
};
export type FlowView = { project: string; at: number; revision: string; supervisors: FlowSeat[]; lanes: FlowLane[]; moreLanes: number; asks: FlowAsk[]; watch: WatchView };
export type Check = { id: string; ok: boolean; detail: string };
