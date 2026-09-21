import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Question } from "../../server/catalog/kit.ts";
import type { Trail } from "../../server/runtime/watch/trail.ts";
import type { Brief } from "../../server/runtime/watch/jev/views.ts";

/**
 * A turn the sensor should read one way, and what each question should say about it.
 *
 * `brief` and `trail` are what `viewsOf` is given for a real seat, so a case is sent the views a
 * seat's turn really sends. `expect` pins every question the case says something about, not only
 * the one it was written for: a scenario that makes a second question fire is how a day's incident
 * budget is spent on one event, and that is worth pinning too.
 */
export type SensorCase = {
  id: string;
  why: string;
  expect: Record<string, "high" | "low">;
  brief: Brief;
  trail: Trail;
};

export const casesFile = join(dirname(fileURLToPath(import.meta.url)), "cases.json");

export function loadCases(): SensorCase[] {
  return JSON.parse(readFileSync(casesFile, "utf-8")) as SensorCase[];
}

/** Where a question's answer stops being low: its own threshold, or the usual bar when it has none. */
export const barOf = (question: Question | undefined): number => question?.threshold ?? 0.7;

export function right(answer: number, want: "high" | "low", bar: number): boolean {
  return want === "high" ? answer >= bar : answer < bar;
}

export const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** Which questions have a case reading each way. A question with neither is one nobody has measured. */
export function covered(cases: SensorCase[]): { high: Set<string>; low: Set<string> } {
  const high = new Set<string>();
  const low = new Set<string>();
  for (const entry of cases) for (const [name, want] of Object.entries(entry.expect)) (want === "high" ? high : low).add(name);
  return { high, low };
}
