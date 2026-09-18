import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parse, stringify } from "smol-toml";

const isToml = (path: string): boolean => extname(path).toLowerCase() === ".toml";

export function readConfig<T>(path: string, fallback: T): T {
  try {
    const text = readFileSync(path, "utf-8");
    return (isToml(path) ? parse(text) : JSON.parse(text)) as T;
  } catch {
    return fallback;
  }
}

/**
 * Why a config could not be read, when it is there and cannot be.
 *
 * These files belong to a harness, not to this plugin: a seat's `.claude.json` holds its account,
 * its machine id and its per-project history. Reading an unparseable one as "not there" and writing
 * the plugin's seed in its place replaces all of that with three keys, and reports it as a routine
 * update. Absent is not a fault — the seed exists for a file that is genuinely not there yet.
 */
export function configFault(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const text = readFileSync(path, "utf-8");
    const held = isToml(path) ? parse(text) : JSON.parse(text);
    return !held || typeof held !== "object" ? `${path} does not hold a config object` : undefined;
  } catch (error) {
    return `${path} is there but could not be read: ${error instanceof Error ? error.message : String(error)}`;
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
  return isToml(path) ? `${stringify(value as Record<string, unknown>).trimEnd()}\n` : `${JSON.stringify(value, null, 2)}\n`;
}
