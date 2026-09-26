import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeConfigAtomic } from "./config-file.ts";
import { errorText } from "./errors.ts";

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
    return { fault: `${path} is there but could not be read: ${errorText(error)}` };
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function readJson<T>(path: string, fallback: T): T {
  const read = readJsonFile(path);
  return "value" in read ? (read.value as T) : fallback;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeConfigAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
