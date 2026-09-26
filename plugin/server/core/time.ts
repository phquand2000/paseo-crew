const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Whole minutes from `at` to `now`, never below zero; `at` may be an ISO date. */
export function minutesSince(now: number, at: number | string): number {
  return Math.max(0, Math.round((now - (typeof at === "string" ? Date.parse(at) : at)) / MINUTE_MS));
}
