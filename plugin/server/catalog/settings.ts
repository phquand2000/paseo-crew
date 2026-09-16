import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { readJson, sortKeys, writeJson } from "../core/store.ts";

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

const RoleChoice = z.strictObject({
  harness: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinking: z.string().min(1).optional(),
});

const Connect = z.strictObject({
  type: z.enum(["stdio", "http", "sse"]),
  command: z.array(z.string().min(1)).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const McpChoice = z.strictObject({
  enabled: z.boolean().optional(),
  removed: z.boolean().optional(),
  label: z.string().min(1).optional(),
  connect: Connect.optional(),
  roles: z.array(z.string()).optional(),
  tools: z.record(z.string(), z.array(z.string())).optional(),
  rule: z.string().optional(),
  settings: z.record(z.string(), Scalar).optional(),
});

export type Connect = z.infer<typeof Connect>;
export type McpChoice = z.infer<typeof McpChoice>;

const LimitsChoice = z.strictObject({
  slots: z.number().int().min(1).max(10).optional(),
  tasksPerLane: z.number().int().min(1).max(20).optional(),
});

const AttentionChoice = z.strictObject({
  tickSeconds: z.number().int().min(5).optional(),
  leadIdleMinutes: z.number().int().min(1).optional(),
  askRemindMinutes: z.number().int().min(1).optional(),
  maxReminders: z.number().int().min(0).optional(),
  watcherDebounceSeconds: z.number().int().min(0).optional(),
  watcherTimeoutSeconds: z.number().int().min(10).optional(),
});

const FlowChoice = z.strictObject({
  live: z.boolean().optional(),
  everySeconds: z.number().int().min(2).max(120).optional(),
});

const shared = {
  roles: z.record(z.string(), RoleChoice).optional(),
  mcp: z.record(z.string(), McpChoice).optional(),
  rules: z.string().optional(),
  limits: LimitsChoice.optional(),
  flow: FlowChoice.optional(),
};

export const ProjectLayerSchema = z.strictObject(shared);
export const MachineLayerSchema = z.strictObject({ ...shared, attention: AttentionChoice.optional() });

export type Layer = z.infer<typeof MachineLayerSchema>;
export type LayerSchema = typeof MachineLayerSchema | typeof ProjectLayerSchema;

export type ReadResult = { status: "ready"; revision: string; values: Layer } | { status: "invalid"; revision: string; error: string };
export type SettingsView = ReadResult & { machine: Layer };
export type WriteResult = { status: "saved"; revision: string; values: Layer } | { status: "conflict"; error: string } | { status: "invalid"; error: string };

export function revisionOf(values: unknown): string {
  return createHash("sha1").update(JSON.stringify(sortKeys(values ?? {}))).digest("hex").slice(0, 16);
}

export function readLayer(file: string, schema: LayerSchema): ReadResult {
  const raw = readJson<unknown>(file, {});
  const revision = revisionOf(raw);
  const parsed = schema.safeParse(raw);
  return parsed.success ? { status: "ready", revision, values: parsed.data } : { status: "invalid", revision, error: z.prettifyError(parsed.error) };
}

export function layerValues(file: string, schema: LayerSchema): Layer {
  const read = readLayer(file, schema);
  return read.status === "ready" ? read.values : {};
}

export function writeLayer(file: string, schema: LayerSchema, revision: string, values: unknown, check: (values: Layer) => string[]): WriteResult {
  if (revisionOf(readJson<unknown>(file, {})) !== revision) {
    return { status: "conflict", error: "The settings changed after they were read; read them again and reapply the change." };
  }
  const parsed = schema.safeParse(values);
  if (!parsed.success) return { status: "invalid", error: z.prettifyError(parsed.error) };
  const problems = check(parsed.data);
  if (problems.length > 0) return { status: "invalid", error: problems.join("\n") };
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, parsed.data);
  return { status: "saved", revision: revisionOf(parsed.data), values: parsed.data };
}
