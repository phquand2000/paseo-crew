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
export type FlowView = { project: string; at: number; revision: string; supervisors: FlowSeat[]; lanes: FlowLane[]; moreLanes: number; asks: FlowAsk[] };
export type Check = { id: string; ok: boolean; detail: string };
