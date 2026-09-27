const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Whole minutes from `at` to `now`, never below zero; `at` may be an ISO date. */
export function minutesSince(now: number, at: number | string): number {
  return Math.max(0, Math.round((now - (typeof at === "string" ? Date.parse(at) : at)) / MINUTE_MS));
}

/** Milliseconds `zone`'s clock runs ahead of UTC at `at`. */
function zoneOffset(zone: string, at: number): number {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const part = Object.fromEntries(format.formatToParts(at).map(({ type, value }) => [type, Number(value)]));
  const wall = Date.UTC(part.year!, part.month! - 1, part.day, part.hour, part.minute, part.second);
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * When a clock time such as "4:30am (Asia/Saigon)" next comes, in its zone or the machine's; up to an hour past counts
 * as past. Anything else, a date included, is undefined.
 */
export function nextTimeOfDay(said: string, now: number): number | undefined {
  const found = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?:\s*\(([^()]+)\))?$/i.exec(said.trim());
  if (!found) return undefined;
  const hour = (Number(found[1]) % 12) + (found[3]!.toLowerCase() === "p" ? 12 : 0);
  const minute = Number(found[2] ?? 0);
  if (Number(found[1]) > 12 || minute > 59) return undefined;
  const zone = found[4]?.trim() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let offset: number;
  try {
    offset = zoneOffset(zone, now);
  } catch {
    // A zone Intl does not know leaves the time unread.
    return undefined;
  }
  const today = new Date(now + offset);
  const at = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hour, minute) - offset;
  return at < now - HOUR_MS ? at + DAY_MS : at;
}
