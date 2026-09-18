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

export type Watching = {
  strikes: Record<string, Strike>;
  pages: number[];
  /** When the last report went out. `digestMinutes` is a period, and without this it bounded nothing. */
  digestedAt?: number;
};

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
    ...(Number.isFinite(stored.digestedAt) ? { digestedAt: stored.digestedAt } : {}),
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
    // Kept when a raise carries none: the strike's evidence is what the report and the letter show.
    evidence: raised.evidence.length > 0 ? raised.evidence : (seen?.evidence ?? []),
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
  return { urgency, watching: { ...watching, strikes: { ...watching.strikes, [key]: strike }, pages: spent }, strike };
}

/**
 * What an interruption cost and what it settled, recorded once it has really gone somewhere.
 *
 * Every delivery is charged, not only the first for a given key: the count carried forward from the
 * previous strike means a repeat offender's second page would otherwise cost nothing, and
 * `pagesPerWindow` would stop bounding anything.
 */
export function delivered(watching: Watching, keys: string[], now: number): Watching {
  // The same two steps `raise` takes, in one: a page reserved per letter, then what they settled.
  return told(reserve(watching, keys.filter((key) => watching.strikes[key]).length, now), keys);
}

/** How many more interruptions this window can take. */
export function pagesLeft(watching: Watching, now: number, rules: WatchRules = WATCH_RULES): number {
  const spent = watching.pages.filter((at) => now - at < rules.windowHours * 3_600_000);
  return Math.max(0, rules.pagesPerWindow - spent.length);
}

/**
 * Everything the owner has an occurrence of that nobody has told them about, each with the key it is
 * filed under. The key is the caller's, not something to rebuild from the strike: `judge` files a
 * strike under its subject and stores its `where`, and those are only the same string because the one
 * caller that raises findings passes the same value for both.
 */
export function pendingEntries(watching: Watching): [string, Strike][] {
  return Object.entries(watching.strikes)
    .filter(([, strike]) => strike.count > (strike.told ?? 0))
    .sort(([, a], [, b]) => b.last - a.last);
}

/** Everything the owner is owed, in the order a report should read it. */
export function pending(watching: Watching): Strike[] {
  return pendingEntries(watching).map(([, strike]) => strike);
}

/**
 * Settle exactly what a report carried, and only that.
 *
 * Takes the counts the report was built from, not the counts on the strike now: a fault that happened
 * again while the report was being posted is not something the report said. Settling everything at
 * its current count swallowed that occurrence, and settling against a snapshot read before the post
 * overwrote it outright — so this is applied to state read back afterwards, and never lowers what an
 * earlier report already settled.
 */
export function reported(watching: Watching, carried: Record<string, number>, at: number): Watching {
  const strikes = { ...watching.strikes };
  for (const [key, count] of Object.entries(carried)) {
    const strike = strikes[key];
    if (!strike) continue;
    strikes[key] = { ...strike, told: Math.max(strike.told ?? 0, count) };
  }
  return { ...watching, strikes, digestedAt: at };
}

/**
 * When the report may next go out: a period after the last one, or after the oldest thing waiting if
 * none has gone yet.
 *
 * A strike keeps its `first` for as long as the fault recurs, so measuring from the oldest sighting
 * meant that once any fault was older than the period the gate was satisfied for ever — every later
 * occurrence sent its own report on the next thirty-second tick, and `digestMinutes` bounded nothing.
 */
export function digestDue(watching: Watching, oldest: number, now: number, minutes: number): boolean {
  return now - (watching.digestedAt ?? oldest) >= minutes * 60_000;
}

/**
 * Pages taken from the window before the letters go, so a raise running beside this one reads a
 * budget that already counts them. Charged only after the post, two raises each read the same unspent
 * window and each sent up to all of it — N raises in parallel cost N pages of a budget of one.
 */
export function reserve(watching: Watching, count: number, now: number): Watching {
  return count > 0 ? { ...watching, pages: [...watching.pages, ...Array.from({ length: count }, () => now)] } : watching;
}

/** Pages reserved at `at` given back, when there turned out to be nobody to interrupt. */
export function refund(watching: Watching, count: number, at: number): Watching {
  const pages = [...watching.pages];
  for (let left = count; left > 0; left--) {
    const index = pages.lastIndexOf(at);
    if (index < 0) break;
    pages.splice(index, 1);
  }
  return { ...watching, pages };
}

/** What the letters that went settled, when their pages were already reserved. */
export function told(watching: Watching, keys: string[]): Watching {
  const strikes = { ...watching.strikes };
  for (const key of keys) if (strikes[key]) strikes[key] = { ...strikes[key]!, told: strikes[key]!.count };
  return { ...watching, strikes };
}
