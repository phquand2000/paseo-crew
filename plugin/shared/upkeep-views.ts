/** The Upkeep section over RPC: what the plugin left behind, its updates, and the kit files the owner changed. */
import { z } from "zod";

const CleanItem = z.object({
  path: z.string(),
  kind: z.enum(["seat", "copy", "records", "snapshot", "backup"]),
  why: z.string(),
  bytes: z.number(),
  careful: z.boolean(),
  held: z.string().nullable(),
});
export type CleanItem = z.infer<typeof CleanItem>;
export const CleanView = z.object({
  items: z.array(CleanItem),
  removed: z.array(z.string()),
  failed: z.array(z.object({ path: z.string(), error: z.string() })),
});
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

const MigrateStep = z.object({
  kind: z.enum(["settings", "seat"]),
  where: z.string(),
  what: z.string(),
  detail: z.array(z.string()),
  auto: z.boolean(),
});
export type MigrateStep = z.infer<typeof MigrateStep>;
/** Guides and records are only told about, never replaced. */
const ContentChange = z.object({
  unit: z.string(),
  kind: z.enum(["guide", "record", "prompt", "skill"]),
  change: z.enum(["added", "changed", "removed"]),
  kept: z.boolean(),
  keepable: z.boolean(),
});
export type ContentChange = z.infer<typeof ContentChange>;
export const MigrateView = z.object({
  stamp: z.string(),
  since: z.string(),
  steps: z.array(MigrateStep),
  done: z.array(z.string()),
  content: z.array(ContentChange),
});
export type MigrateView = z.infer<typeof MigrateView>;
