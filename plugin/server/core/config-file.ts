import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parse, stringify } from "smol-toml";
import { errorText } from "./errors.ts";

const isToml = (path: string): boolean => extname(path).toLowerCase() === ".toml";

export function readConfig<T>(path: string, fallback: T): T {
  try {
    const text = readFileSync(path, "utf-8");
    return (isToml(path) ? parse(text) : JSON.parse(text)) as T;
  } catch {
    return fallback;
  }
}

/** Unparseable is a fault, not absent: seeding over a harness's config would erase its account and history. */
export function configFault(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const text = readFileSync(path, "utf-8");
    const held = (isToml(path) ? parse(text) : JSON.parse(text)) as unknown;
    return !held || typeof held !== "object" ? `${path} does not hold a config object` : undefined;
  } catch (error) {
    return `${path} is there but could not be read: ${errorText(error)}`;
  }
}

/** Written whole or not at all, because a harness may be reading it while this runs. */
export function writeConfigAtomic(path: string, text: string, mode = 0o600): void {
  const staging = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(staging, text, { mode });
    renameSync(staging, path);
  } catch (error) {
    // A full disk stops this between the two lines; the half-written file is not left beside the real one.
    rmSync(staging, { force: true });
    throw error;
  }
}

export function formatConfig(path: string, value: unknown): string {
  return isToml(path) ? `${stringify(value).trimEnd()}\n` : `${JSON.stringify(value, null, 2)}\n`;
}
