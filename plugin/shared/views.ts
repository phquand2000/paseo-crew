/** What the panel reads over RPC, one schema per answer: the client checks every answer against it, and both sides take their types from it. */
import { z } from "zod";
import { Connect, LayerSchema, Scalar } from "./settings.ts";

/** A call the panel made that the plugin refused, and why. */
export const Refused = z.object({ error: z.string() });

export const Check = z.object({ id: z.string(), ok: z.boolean(), detail: z.string() });
export type Check = z.infer<typeof Check>;

const ModelView = z.object({
  id: z.string(),
  label: z.string(),
  isDefault: z.boolean().optional(),
  thinkingOptions: z
    .array(z.object({ id: z.string(), label: z.string(), isDefault: z.boolean().optional() }))
    .optional(),
});
const SettingSpec = z.object({
  type: z.enum(["number", "string", "boolean"]),
  label: z.string(),
  default: Scalar.optional(),
});
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
  harnesses: z.array(
    z.object({ id: z.string(), label: z.string(), models: z.array(ModelView), transports: z.array(z.string()) }),
  ),
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
  sensors: z.array(
    z.object({ id: z.string(), label: z.string(), key: z.string(), model: z.string(), terms: z.string() }),
  ),
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
    z.object({
      label: z.string(),
      enabled: z.boolean(),
      roles: z.array(z.string()),
      settings: z.record(z.string(), Scalar),
      transport: z.string(),
      template: z.boolean(),
      connect: Connect.nullable(),
      rule: z.string().nullable(),
    }),
  ),
  roles: z.record(
    z.string(),
    z.object({
      harness: z.string(),
      provider: z.string(),
      model: z.string().nullable(),
      thinking: z.string().nullable(),
      mcp: z.array(z.string()),
      tools: z.record(z.string(), z.array(z.string())),
      skills: z.array(z.string()),
      rules: z.string(),
    }),
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
export const Folders = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  repository: z.boolean(),
  root: z.string().nullable(),
  folders: z.array(Folder),
});
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
  riskRules: z.array(
    z.object({
      paths: z.array(z.string()),
      invariant: z.string(),
      reviewQuestion: z.string(),
      rehearse: z.string().nullable(),
    }),
  ),
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
export const ModelsRefreshed = z.record(
  z.string(),
  z.object({ at: z.string(), error: z.string().nullable(), count: z.number() }),
);
export type ModelsRefreshed = z.infer<typeof ModelsRefreshed>;
