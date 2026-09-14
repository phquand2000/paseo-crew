import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { type Kit, readJson, watcherSeat } from "./kit.ts";

export type Attention = { sweepMinutes: number; pushbackMinutes: number; escalateAfter: number };
export type Project = {
  root: string;
  slug: string;
  models: Record<string, string>;
  attention: Attention;
  problems: string[];
};

export const PROJECT_FILE = join(".seatworks", "project.json");

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readProject(root: string, stored: unknown, kit?: Kit): Project {
  const problems: string[] = [];
  const file = isObject(stored) ? stored : {};
  if (stored !== undefined && !isObject(stored)) problems.push("is not a JSON object; using defaults");

  const slug = typeof file.slug === "string" && file.slug ? file.slug : basename(root);

  const models: Record<string, string> = {};
  if (file.models !== undefined && !isObject(file.models)) problems.push("models must map a role to a model id; ignoring it");
  for (const [role, model] of Object.entries(isObject(file.models) ? file.models : {})) {
    if (typeof model === "string" && model) models[role] = model;
    else problems.push(`models.${role} must be a model id; ignoring it`);
  }

  if (file.attention !== undefined && !isObject(file.attention)) problems.push("attention must be an object; using defaults");
  const given = isObject(file.attention) ? file.attention : {};
  const setting = (key: keyof Attention, fallback: number): number => {
    const value = given[key];
    if (value === undefined) return fallback;
    if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
    problems.push(`attention.${key} must be a whole number of at least 1; using ${fallback}`);
    return fallback;
  };
  const sweepMinutes = setting("sweepMinutes", (kit && watcherSeat(kit)?.sweepMinutes) || 10);
  const pushbackMinutes = setting("pushbackMinutes", 2 * sweepMinutes);
  const escalateAfter = setting("escalateAfter", 3);

  return { root, slug, models, attention: { sweepMinutes, pushbackMinutes, escalateAfter }, problems };
}

export function projectAt(root: string, kit?: Kit): Project {
  const path = join(root, PROJECT_FILE);
  const stored = readJson<unknown>(path);
  const project = readProject(root, stored, kit);
  if (stored === undefined && existsSync(path)) project.problems.unshift("is not valid JSON; using defaults");
  return project;
}
