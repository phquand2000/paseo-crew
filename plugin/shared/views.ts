/** What the panel reads over RPC, one schema per answer: the client checks every answer against it, and both sides take their types from it. */
import { z } from "zod";
import { Connect, LayerSchema, Scalar } from "./settings.ts";

const Refused = z.object({ error: z.string() });

export const Check = z.object({ id: z.string(), ok: z.boolean(), detail: z.string() });
export type Check = z.infer<typeof Check>;

const ModelView = z.object({ id: z.string(), label: z.string(), isDefault: z.boolean().optional(), thinkingOptions: z.array(z.object({ id: z.string(), label: z.string(), isDefault: z.boolean().optional() })).optional() });
const SettingSpec = z.object({ type: z.enum(["number", "string", "boolean"]), label: z.string(), default: Scalar.optional() });
export type SettingSpec = z.infer<typeof SettingSpec>;

export const CatalogView = z.object({
  roles: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      can: z.array(z.string()),
      concern: z.string().nullable(),
      defaults: z.object({ harness: z.string(), model: z.string().optional(), thinking: z.string().optional() }),
      follows: z.string().nullable(),
      harnesses: z.array(z.string()),
    }),
  ),
  harnesses: z.array(z.object({ id: z.string(), label: z.string(), models: z.array(ModelView), transports: z.array(z.string()) })),
  mcp: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      kind: z.string(),
      transport: z.string(),
      settings: z.record(z.string(), SettingSpec),
      defaults: z.object({ enabled: z.boolean() }),
      roles: z.array(z.string()),
    }),
  ),
  sensors: z.array(z.object({ id: z.string(), label: z.string(), key: z.string(), model: z.string(), terms: z.string() })),
});
export type CatalogView = z.infer<typeof CatalogView>;

/** The attention settings in force, every one resolved: what the watch and the round run on. */
const Attention = z.object({
  tickSeconds: z.number(),
  leadIdleMinutes: z.number(),
  askRemindMinutes: z.number(),
  maxReminders: z.number(),
  watch: z.boolean(),
  destructive: z.string(),
  testPath: z.string(),
  repeatsAt: z.number(),
  reworksAt: z.number(),
  reviewsAt: z.number(),
  suppressed: z.string(),
  longTurnMinutes: z.number(),
  incidentsPerLane: z.number(),
  questionsPerDay: z.number(),
  judge: z.string(),
});
export type Attention = z.infer<typeof Attention>;

export const TeamView = z.object({
  project: z.string().nullable(),
  errors: z.array(z.string()),
  attention: Attention,
  rules: z.string(),
  mcp: z.record(
    z.string(),
    z.object({ label: z.string(), enabled: z.boolean(), roles: z.array(z.string()), settings: z.record(z.string(), Scalar), transport: z.string(), template: z.boolean(), connect: Connect.nullable(), rule: z.string().nullable() }),
  ),
  roles: z.record(
    z.string(),
    z.object({ harness: z.string(), provider: z.string(), model: z.string().nullable(), thinking: z.string().nullable(), mcp: z.array(z.string()), tools: z.record(z.string(), z.array(z.string())), skills: z.array(z.string()), rules: z.string() }),
  ),
});
export type TeamView = z.infer<typeof TeamView>;
export const TeamRead = z.union([TeamView, Refused]);
export type TeamRead = z.infer<typeof TeamRead>;

const LayerRead = z.union([
  z.object({ status: z.literal("ready"), revision: z.string(), values: LayerSchema }),
  z.object({ status: z.literal("invalid"), revision: z.string(), error: z.string() }),
]);
export type LayerRead = z.infer<typeof LayerRead>;
export const SettingsRead = z.intersection(LayerRead, z.object({ machine: LayerSchema }));
export type SettingsRead = z.infer<typeof SettingsRead>;

export const WriteResult = z.union([
  z.object({ status: z.literal("saved"), revision: z.string(), values: LayerSchema }),
  z.object({ status: z.enum(["conflict", "invalid"]), error: z.string() }),
]);
export type WriteResult = z.infer<typeof WriteResult>;

export const ProjectRow = z.object({ slug: z.string(), root: z.string() });
export type ProjectRow = z.infer<typeof ProjectRow>;
export const Added = z.union([ProjectRow, Refused]);
export type Added = z.infer<typeof Added>;
export const Removed = z.union([z.object({ removed: z.string() }), Refused]);
export type Removed = z.infer<typeof Removed>;
export const Parsed = z.union([z.object({ id: z.string(), label: z.string(), connect: Connect }), Refused]);
export type Parsed = z.infer<typeof Parsed>;

const Folder = z.object({ name: z.string(), path: z.string(), repository: z.boolean() });
/** `root` is the repository this folder belongs to when it is not itself that repository's top. */
export const Folders = z.object({ path: z.string(), parent: z.string().nullable(), repository: z.boolean(), root: z.string().nullable(), folders: z.array(Folder) });
export type Folders = z.infer<typeof Folders>;
export const Paths = z.union([Folders, Refused]);
export type Paths = z.infer<typeof Paths>;

export const StatusView = z.object({ text: z.string(), error: z.string().optional() });
export type StatusView = z.infer<typeof StatusView>;
export const LandDecided = z.union([z.object({ decided: z.string() }), Refused]);
export type LandDecided = z.infer<typeof LandDecided>;
export const QuestionAnswered = z.union([z.object({ answered: z.string() }), Refused]);
export type QuestionAnswered = z.infer<typeof QuestionAnswered>;

/** The Human's standing orders for a project, as they settled them, and its concept as the Supervisor wrote it down. */
const OrdersView = z.object({
  fault: z.string().nullable(),
  askFirst: z.array(z.string()),
  riskRules: z.array(z.object({ paths: z.array(z.string()), invariant: z.string(), reviewQuestion: z.string(), rehearse: z.string().nullable() })),
  ownRules: z.boolean(),
  laneHome: z.string().nullable(),
  concept: z.object({ text: z.string(), minutes: z.number(), more: z.boolean() }).nullable(),
});
export type OrdersView = z.infer<typeof OrdersView>;
export const OrdersRead = z.union([OrdersView, Refused]);
export type OrdersRead = z.infer<typeof OrdersRead>;

const ReportItem = z.object({ title: z.string(), detail: z.string(), minutes: z.number() });
export type ReportItem = z.infer<typeof ReportItem>;
/** What happened in a project over the last day, built from its record with no agent's words in it. */
const ReportView = z.object({
  needs: z.array(ReportItem),
  ahead: z.array(ReportItem),
  landed: z.array(ReportItem),
  beyond: z.array(ReportItem),
  numbers: z.array(z.object({ title: z.string(), value: z.string(), detail: z.string() })),
});
export type ReportView = z.infer<typeof ReportView>;
export const ReportRead = z.union([ReportView, Refused]);
export type ReportRead = z.infer<typeof ReportRead>;
export const ModelsRefreshed = z.record(z.string(), z.object({ at: z.string(), error: z.string().nullable(), count: z.number() }));
export type ModelsRefreshed = z.infer<typeof ModelsRefreshed>;

const FlowSeat = z.object({ id: z.string(), role: z.string(), status: z.string(), minutes: z.number(), waiting: z.array(z.string()) });
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
  landApproval: z.object({ minutes: z.number(), approved: z.boolean(), signals: z.array(z.string()), evidence: z.array(z.string()) }).optional(),
  workspaceId: z.string().optional(),
  onHold: z.object({ minutes: z.number(), reason: z.string() }).optional(),
  ready: z.number().optional(),
});
export type FlowLane = z.infer<typeof FlowLane>;
const FlowAsk = z.object({ id: z.string(), kind: z.string(), fromRole: z.string(), to: z.string(), minutes: z.number(), text: z.string() });
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
const WatchJudge = z.object({ label: z.string(), state: z.enum(["off", "nokey", "waiting", "answering", "failing"]), minutes: z.number().nullable(), detail: z.string().nullable() });
export type WatchJudge = z.infer<typeof WatchJudge>;
/** What the code noticed about the seats and nobody has marked yet, the trouble nobody is mailed about, and who answers the watch's questions. */
const WatchView = z.object({ incidents: z.array(WatchIncident), trouble: z.array(z.object({ kind: z.string(), minutes: z.number(), detail: z.string() })), judge: WatchJudge });
export type WatchView = z.infer<typeof WatchView>;
const FlowView = z.object({ project: z.string(), at: z.number(), revision: z.string(), supervisors: z.array(FlowSeat), lanes: z.array(FlowLane), moreLanes: z.number(), asks: z.array(FlowAsk), questions: z.array(FlowQuestion), watch: WatchView });
export type FlowView = z.infer<typeof FlowView>;
export const FlowRead = z.union([FlowView, z.object({ unchanged: z.literal(true), revision: z.string() }), Refused]);
export type FlowRead = z.infer<typeof FlowRead>;

const CleanItem = z.object({ path: z.string(), kind: z.enum(["seat", "copy", "records", "snapshot", "backup"]), why: z.string(), bytes: z.number(), careful: z.boolean(), held: z.string().nullable() });
export type CleanItem = z.infer<typeof CleanItem>;
export const CleanView = z.object({ items: z.array(CleanItem), removed: z.array(z.string()), failed: z.array(z.object({ path: z.string(), error: z.string() })) });
export type CleanView = z.infer<typeof CleanView>;

export const UpdateView = z.object({
  dir: z.string(),
  version: z.string(),
  next: z.string().nullable(),
  head: z.string(),
  date: z.string().nullable(),
  fetched: z.boolean(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  behind: z.number(),
  ahead: z.number(),
  commits: z.array(z.object({ sha: z.string(), subject: z.string() })),
  installs: z.boolean(),
  paseo: z.string().nullable(),
  blocked: z.string().nullable(),
  busy: z.array(z.string()),
  updated: z.object({ from: z.string(), to: z.string() }).nullable(),
});
export type UpdateView = z.infer<typeof UpdateView>;

const MigrateStep = z.object({ kind: z.enum(["settings", "seat"]), where: z.string(), what: z.string(), detail: z.array(z.string()), auto: z.boolean() });
export type MigrateStep = z.infer<typeof MigrateStep>;
/** Guides and records are only told about, never replaced. */
const ContentChange = z.object({ unit: z.string(), kind: z.enum(["guide", "record", "prompt", "skill"]), change: z.enum(["added", "changed", "removed"]), kept: z.boolean(), keepable: z.boolean() });
export type ContentChange = z.infer<typeof ContentChange>;
export const MigrateView = z.object({ stamp: z.string(), since: z.string(), steps: z.array(MigrateStep), done: z.array(z.string()), content: z.array(ContentChange) });
export type MigrateView = z.infer<typeof MigrateView>;
