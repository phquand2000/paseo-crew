import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parse, stringify } from "smol-toml";
import { errorText } from "./errors.ts";

const isToml = (path: string): boolean => extname(path).toLowerCase() === ".toml";

/** Why a file did not parse, by where alone: a parser quotes the text, and the file may hold a key. */
export function parseProblem(path: string, error: unknown): string {
  const at = error as { line?: unknown; column?: unknown };
  const where =
    typeof at.line === "number" && typeof at.column === "number"
      ? ` at line ${at.line} column ${at.column}`
      : (/ at position \d+(?: \(line \d+ column \d+\))?/.exec(errorText(error))?.[0] ?? "");
  return `it is not ${isToml(path) ? "TOML" : "JSON"}${where}`;
}

function readFile(path: string): { absent: true } | { value: unknown } | { problem: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { absent: true } : { problem: errorText(error) };
  }
  try {
    return { value: (isToml(path) ? parse(text) : JSON.parse(text)) as unknown };
  } catch (error) {
    return { problem: parseProblem(path, error) };
  }
}

export function readConfig<T>(path: string, fallback: T): T {
  const read = readFile(path);
  return "value" in read ? (read.value as T) : fallback;
}

/** Unparseable is a fault, not absent: seeding over a harness's config would erase its account and history. */
export function configFault(path: string): string | undefined {
  const read = readFile(path);
  if ("problem" in read) return `${path} is there but could not be read: ${read.problem}`;
  return "value" in read && (!read.value || typeof read.value !== "object")
    ? `${path} does not hold a config object`
    : undefined;
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
