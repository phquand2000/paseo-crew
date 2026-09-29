import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseProblem, writeConfigAtomic } from "./config-file.ts";
import { errorText } from "./errors.ts";
import { daemonLog } from "./logger.ts";

/** A kept file as read once: missing, its parsed value, or why it could not be read, which is never taken for missing. */
type JsonRead = { absent: true } | { value: unknown } | { fault: string };

export function readJsonFile(path: string): JsonRead {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { absent: true };
    return { fault: `${path} is there but could not be read: ${errorText(error)}` };
  }
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return { fault: `${path} is there but could not be read: ${parseProblem(path, error)}` };
  }
}

/** A file the plugin keeps and cannot rebuild: `empty` while absent, a fault when unreadable or not what `holds` accepts. */
export function readKept<T>(
  path: string,
  empty: T,
  holds: (value: unknown) => value is T,
): { value: T } | { fault: string } {
  const read = readJsonFile(path);
  if ("fault" in read) return read;
  if ("absent" in read) return { value: empty };
  return holds(read.value) ? { value: read.value } : { fault: `${path} does not hold what the plugin keeps there` };
}

export function keptFault(fault: string): Error {
  return new Error(`${fault}. Nothing was written over it. Only the Human can repair it or move it aside.`);
}

/** A kept file whose readers go on without it: a fault reads as nothing and goes to the daemon log once while it lasts. */
export class KeptFile<T> {
  private readonly path: string;
  private readonly empty: T;
  private readonly holds: (value: unknown) => value is T;
  private told?: string;

  constructor(path: string, empty: T, holds: (value: unknown) => value is T) {
    this.path = path;
    this.empty = empty;
    this.holds = holds;
  }

  read(): { value: T } | { fault: string } {
    return readKept(this.path, this.empty, this.holds);
  }

  quiet(): T | undefined {
    const read = this.read();
    if ("value" in read) {
      this.told = undefined;
      return read.value;
    }
    if (this.told !== read.fault) daemonLog.error(keptFault(read.fault).message);
    this.told = read.fault;
    return undefined;
  }

  /** Writes what `change` makes of the file as it stands; nothing when it cannot be read or `change` changes nothing. */
  change(change: (value: T) => T | undefined): void {
    const value = this.quiet();
    const next = value === undefined ? undefined : change(value);
    if (next !== undefined) writeJson(this.path, next);
  }
}

export function readJson<T>(path: string, fallback: T): T {
  const read = readJsonFile(path);
  return "value" in read ? (read.value as T) : fallback;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeConfigAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
