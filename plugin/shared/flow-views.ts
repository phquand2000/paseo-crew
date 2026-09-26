/** The Flow tab over RPC: lanes, tasks, asks and questions as the desk has them, and what the watch has noticed. */
import { z } from "zod";
import { Refused } from "./views.ts";

const FlowSeat = z.object({
  id: z.string(),
  role: z.string(),
  status: z.string(),
  minutes: z.number(),
  waiting: z.array(z.string()),
});
export type FlowSeat = z.infer<typeof FlowSeat>;
/** `copy` names a parallel task's own copy; `after` is what a waiting task waits for, and `held` why a task cannot start or merge yet. */
const FlowTask = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  kind: z.string(),
  mode: z.enum(["lane", "parallel"]),
  copy: z.string().nullable(),
  after: z.array(z.string()),
  held: z.string().nullable(),
  peer: FlowSeat.nullable(),
  minutes: z.number(),
  handback: z.number().nullable(),
});
export type FlowTask = z.infer<typeof FlowTask>;
/** A Peer kept idle after its task was accepted, until its Lead releases it. */
const FlowKept = FlowSeat.extend({ task: z.string() });
/** `copy` is the lane's own working copy, none for the Human's checkout; `kept` its Peers idle after their tasks; `landed` how a lane whose Lead is kept closed. */
const FlowLane = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  branch: z.string(),
  base: z.string().optional(),
  copy: z.string().nullable(),
  lead: FlowSeat.nullable(),
  kept: z.array(FlowKept),
  landed: z.boolean().optional(),
  tasks: z.array(FlowTask),
  taskCount: z.number(),
  running: z.number(),
  open: z.boolean(),
  after: z.array(z.string()).optional(),
  held: z.string().optional(),
  landApproval: z
    .object({ minutes: z.number(), approved: z.boolean(), signals: z.array(z.string()), evidence: z.array(z.string()) })
    .optional(),
  workspaceId: z.string().optional(),
  onHold: z.object({ minutes: z.number(), reason: z.string() }).optional(),
  ready: z.number().optional(),
});
export type FlowLane = z.infer<typeof FlowLane>;
const FlowAsk = z.object({
  id: z.string(),
  kind: z.string(),
  fromRole: z.string(),
  to: z.string(),
  minutes: z.number(),
  text: z.string(),
});
export type FlowAsk = z.infer<typeof FlowAsk>;
const FlowQuestion = z.object({
  id: z.string(),
  question: z.string(),
  why: z.string(),
  lane: z.string().nullable(),
  class: z.enum(["reversible", "costly", "irreversible"]),
  options: z.array(z.object({ label: z.string(), effect: z.string() })),
  recommend: z.string(),
  reason: z.string(),
  ifSilent: z.string(),
  minutes: z.number(),
});
export type FlowQuestion = z.infer<typeof FlowQuestion>;
const WatchIncident = z.object({
  id: z.string(),
  title: z.string(),
  level: z.enum(["page", "attend"]),
  name: z.string(),
  minutes: z.number(),
  quote: z.string(),
  told: z.enum(["lead", "supervisor"]).nullable(),
  lane: z.string().nullable(),
  held: z.string().nullable(),
});
export type WatchIncident = z.infer<typeof WatchIncident>;
/** Who answers the watch's questions, and how that stands: off, a sensor with no key, nothing asked yet, its last answer, or its last failure. */
const WatchJudge = z.object({
  label: z.string(),
  state: z.enum(["off", "nokey", "waiting", "answering", "failing"]),
  minutes: z.number().nullable(),
  detail: z.string().nullable(),
});
export type WatchJudge = z.infer<typeof WatchJudge>;
/** What the code noticed about the seats and nobody has marked yet, the trouble nobody is mailed about, and who answers the watch's questions. */
const WatchView = z.object({
  incidents: z.array(WatchIncident),
  trouble: z.array(z.object({ kind: z.string(), minutes: z.number(), detail: z.string() })),
  judge: WatchJudge,
});
export type WatchView = z.infer<typeof WatchView>;
const FlowView = z.object({
  project: z.string(),
  at: z.number(),
  revision: z.string(),
  supervisors: z.array(FlowSeat),
  lanes: z.array(FlowLane),
  moreLanes: z.number(),
  asks: z.array(FlowAsk),
  questions: z.array(FlowQuestion),
  watch: WatchView,
});
export type FlowView = z.infer<typeof FlowView>;
export const FlowRead = z.union([FlowView, z.object({ unchanged: z.literal(true), revision: z.string() }), Refused]);
export type FlowRead = z.infer<typeof FlowRead>;
