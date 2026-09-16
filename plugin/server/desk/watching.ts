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
  reportedAt?: number;
};

export type Watching = { strikes: Record<string, Strike>; pages: number[] };

export type WatchRules = { strikesAt: number; pagesPerWindow: number; windowHours: number; always: string[] };

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
  if (raised.label === "normal") return { urgency: "log", watching };

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
    reportedAt: seen?.reportedAt,
  };

  const spent = watching.pages.filter((at) => now - at < rules.windowHours * 3_600_000);
  const irreversible = rules.always.includes(raised.label);
  const struckOut = strike.count >= rules.strikesAt;
  const urgency: Urgency = irreversible || (struckOut && spent.length < rules.pagesPerWindow) ? "page" : "digest";

  if (urgency === "page") {
    strike.reportedAt = now;
    spent.push(now);
  }

  return { urgency, watching: { strikes: { ...watching.strikes, [key]: strike }, pages: spent }, strike };
}

export function pending(watching: Watching): Strike[] {
  return Object.values(watching.strikes)
    .filter((strike) => !strike.reportedAt)
    .sort((a, b) => b.last - a.last);
}

export function reported(watching: Watching, now: number): Watching {
  const strikes: Record<string, Strike> = {};
  for (const [key, strike] of Object.entries(watching.strikes)) strikes[key] = strike.reportedAt ? strike : { ...strike, reportedAt: now };
  return { strikes, pages: watching.pages };
}
