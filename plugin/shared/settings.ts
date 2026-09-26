import { z } from "zod";

export const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export const RoleChoice = z.strictObject({
  harness: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinking: z.string().min(1).optional(),
  rules: z.string().optional(),
});

export const Connect = z.strictObject({
  type: z.enum(["stdio", "http", "sse"]),
  command: z.array(z.string().min(1)).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const McpChoice = z.strictObject({
  enabled: z.boolean().optional(),
  removed: z.boolean().optional(),
  label: z.string().min(1).optional(),
  connect: Connect.optional(),
  roles: z.array(z.string()).optional(),
  tools: z.record(z.string(), z.array(z.string())).optional(),
  rule: z.string().optional(),
  settings: z.record(z.string(), Scalar).optional(),
});

export type Scalar = z.infer<typeof Scalar>;
export type RoleChoice = z.infer<typeof RoleChoice>;
export type Connect = z.infer<typeof Connect>;
export type McpChoice = z.infer<typeof McpChoice>;

const Pattern = z.string().min(1).refine(
  (value) => {
    try {
      new RegExp(value, "i");
      return true;
    } catch {
      return false;
    }
  },
  { message: "that is not a pattern this machine can read" },
);

export const AttentionChoice = z.strictObject({
  tickSeconds: z.number().int().min(5).optional(),
  leadIdleMinutes: z.number().int().min(1).optional(),
  askRemindMinutes: z.number().int().min(1).optional(),
  maxReminders: z.number().int().min(0).optional(),
  watch: z.boolean().optional(),
  destructive: Pattern.optional(),
  testPath: Pattern.optional(),
  repeatsAt: z.number().int().min(2).optional(),
  reworksAt: z.number().int().min(2).optional(),
  reviewsAt: z.number().int().min(2).optional(),
  suppressed: Pattern.optional(),
  longTurnMinutes: z.number().int().min(1).optional(),
  incidentsPerLane: z.number().int().min(0).optional(),
  questionsPerDay: z.number().int().min(0).optional(),
  judge: z.string().min(1).optional(),
});

/** A sensor's key buys paid calls, so it is kept on this machine only and the screen never reads it back: it sees KEPT. */
const SensorChoice = z.strictObject({ key: z.string().min(1).optional() });

export const KEPT = "kept, not shown";

const FlowChoice = z.strictObject({
  live: z.boolean().optional(),
  everySeconds: z.number().int().min(2).max(120).optional(),
});

/** One shape for both layers: the machine's, and a project's over it. */
export const LayerSchema = z.strictObject({
  roles: z.record(z.string(), RoleChoice).optional(),
  mcp: z.record(z.string(), McpChoice).optional(),
  rules: z.string().optional(),
  flow: FlowChoice.optional(),
  attention: AttentionChoice.optional(),
  sensor: z.record(z.string(), SensorChoice).optional(),
});

export type Layer = z.infer<typeof LayerSchema>;
export type AttentionChoice = z.infer<typeof AttentionChoice>;
