import { join } from "node:path";
import { readJson, writeJson } from "../core/store.ts";

export type Urgency = "log" | "digest" | "page";

export type Raised = { subject: string; label: string; where: string; quote: string; evidence: string[] };

export type Strike = {
  label: string;
  where: string;
  quote: string;
  evidence: string[];
  first: number;
  last: number;
  count: number;
  /**
   * How many of these occurrences the owner has been told about.
   *
   * Not *whether* they were told: a fault they have heard about once and that has now happened again
   * is something they have not heard. Asking only whether a stamp was present made every recurrence
   * of an already-reported fault invisible to the report, and every branch that did not want that had
   * to remember to take the stamp back off. Counting what was told needs nobody to remember anything.
   */
  told?: number;
};

export type Watching = { strikes: Record<string, Strike>; pages: number[] };

export type WatchRules = { strikesAt: number; pagesPerWindow: number; windowHours: number; always: string[]; watch?: boolean };

export const WATCH_RULES: WatchRules = { strikesAt: 3, pagesPerWindow: 2, windowHours: 12, always: ["destructive"] };

export function watchingFile(state: string): string {
  return join(state, "watching.json");
}

export function emptyWatching(): Watching {
  return { strikes: {}, pages: [] };
}

export function loadWatching(state: string): Watching {
  const stored = readJson<Partial<Watching>>(watchingFile(state), {});
  return {
    strikes: stored.strikes && typeof stored.strikes === "object" ? stored.strikes : {},
    pages: Array.isArray(stored.pages) ? stored.pages.filter((at) => Number.isFinite(at)) : [],
  };
}

export function saveWatching(state: string, watching: Watching): void {
  writeJson(watchingFile(state), watching);
}

export function keyOf(subject: string, label: string): string {
  return `${subject}:${label}`;
}

export function judge(watching: Watching, raised: Raised, now: number, rules: WatchRules = WATCH_RULES): { urgency: Urgency; watching: Watching; strike?: Strike } {
  const key = keyOf(raised.subject, raised.label);
  const seen = watching.strikes[key];
  const strike: Strike = {
    label: raised.label,
    where: raised.where,
    quote: raised.quote,
    evidence: raised.evidence,
    first: seen?.first ?? now,
    last: now,
    count: (seen?.count ?? 0) + 1,
    told: seen?.told,
  };

  // Off records what was seen and stops the desk deciding any of it is worth a turn. The strike is
  // built either way, so the report the seat is promised can still carry it.
  if (rules.watch === false) return { urgency: "log", watching: { ...watching, strikes: { ...watching.strikes, [key]: strike } }, strike };

  const spent = watching.pages.filter((at) => now - at < rules.windowHours * 3_600_000);
  const irreversible = rules.always.includes(raised.label);
  const struckOut = strike.count >= rules.strikesAt;
  const urgency: Urgency = irreversible || (struckOut && spent.length < rules.pagesPerWindow) ? "page" : "digest";

  // Deciding to interrupt is not interrupting. Counting it as told here dropped the finding from the
  // digest — the only other way it is ever read — when there turned out to be nobody to interrupt.
  return { urgency, watching: { strikes: { ...watching.strikes, [key]: strike }, pages: spent }, strike };
}

/**
 * What an interruption cost and what it settled, recorded once it has really gone somewhere.
 *
 * Every delivery is charged, not only the first for a given key: the count carried forward from the
 * previous strike means a repeat offender's second page would otherwise cost nothing, and
 * `pagesPerWindow` would stop bounding anything.
 */
export function delivered(watching: Watching, keys: string[], now: number): Watching {
  const strikes = { ...watching.strikes };
  const pages = [...watching.pages];
  for (const key of keys) {
    const strike = strikes[key];
    if (!strike) continue;
    strikes[key] = { ...strike, told: strike.count };
    pages.push(now);
  }
  return { strikes, pages };
}

/** How many more interruptions this window can take. */
export function pagesLeft(watching: Watching, now: number, rules: WatchRules = WATCH_RULES): number {
  const spent = watching.pages.filter((at) => now - at < rules.windowHours * 3_600_000);
  return Math.max(0, rules.pagesPerWindow - spent.length);
}

/** Everything the owner has an occurrence of that nobody has told them about. */
export function pending(watching: Watching): Strike[] {
  return Object.values(watching.strikes)
    .filter((strike) => strike.count > (strike.told ?? 0))
    .sort((a, b) => b.last - a.last);
}

export function reported(watching: Watching): Watching {
  const strikes: Record<string, Strike> = {};
  for (const [key, strike] of Object.entries(watching.strikes)) strikes[key] = { ...strike, told: strike.count };
  return { strikes, pages: watching.pages };
}
