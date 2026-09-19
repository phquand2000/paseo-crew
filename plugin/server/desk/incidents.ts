import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "../core/store.ts";

export type Held = "shadow" | "budget" | "nobody" | "awaiting" | "vetoed";

export type Judged = { question: string; p: number; model: string; says: "confirms" | "vetoes" | "unclear" };

export type Incident = {
  id: string;
  seat: string;
  provider?: string;
  where: string;
  lane?: string;
  task?: string;
  kind: string;
  level: "page" | "attend";
  quote: string;
  later?: string;
  facts: string[];
  p?: number;
  model?: string;
  sensor?: Judged;
  opened: number;
  last: number;
  count: number;
  open: boolean;
  told?: number;
  held?: Held;
  label?: "useful" | "noise" | "unknown";
  note?: string;
  ackedBy?: string;
  closed?: number;
};

export type Incidents = { next: number; items: Record<string, Incident> };

export type Sighting = Omit<Incident, "id" | "opened" | "last" | "count" | "open" | "told" | "held" | "label" | "note" | "ackedBy" | "closed" | "later" | "sensor">;

export const DAY_MS = 24 * 3_600_000;

export function incidentsFile(state: string): string {
  return join(state, "incidents.json");
}

export function incidentsFault(state: string): string | undefined {
  const file = incidentsFile(state);
  if (!existsSync(file)) return undefined;
  let stored: unknown;
  try {
    stored = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    return `${file} is there but could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  const items = (stored as { items?: unknown } | null)?.items;
  if (!stored || typeof stored !== "object" || Array.isArray(stored) || !items || typeof items !== "object" || Array.isArray(items)) return `${file} does not hold a record of incidents`;
  return undefined;
}

export function loadIncidents(state: string): Incidents {
  const stored = readJson<Partial<Incidents>>(incidentsFile(state), {});
  return {
    next: Number.isInteger(stored.next) && (stored.next as number) > 0 ? (stored.next as number) : 1,
    items: stored.items && typeof stored.items === "object" ? stored.items : {},
  };
}

export function saveIncidents(state: string, incidents: Incidents): void {
  writeJson(incidentsFile(state), incidents);
}

export function openFor(incidents: Incidents, seat: string, kind: string): Incident | undefined {
  return Object.values(incidents.items).find((item) => item.open && item.seat === seat && item.kind === kind);
}

export function sight(incidents: Incidents, sighting: Sighting, now: number): { incident: Incident; opened: boolean } {
  const seen = openFor(incidents, sighting.seat, sighting.kind);
  if (seen) {
    Object.assign(seen, { facts: [...new Set([...seen.facts, ...sighting.facts])], last: now, count: seen.count + 1 });
    if (sighting.level === "page" && seen.level === "attend") {
      Object.assign(seen, { level: "page", quote: sighting.quote });
      if (sighting.p !== undefined) seen.p = sighting.p;
      for (const key of ["told", "later", "held", "sensor"] as const) delete seen[key];
      return { incident: seen, opened: false };
    }
    if (seen.told === undefined) {
      delete seen.sensor;
      seen.quote = sighting.quote;
      if (sighting.p !== undefined) seen.p = sighting.p;
      if (sighting.level === "page") seen.level = "page";
    } else seen.later = sighting.quote;
    return { incident: seen, opened: false };
  }
  const incident: Incident = { ...sighting, id: `I${incidents.next}`, opened: now, last: now, count: 1, open: true };
  incidents.next += 1;
  incidents.items[incident.id] = incident;
  return { incident, opened: true };
}

export function spentToday(incidents: Incidents, now: number): number {
  return Object.values(incidents.items).filter((item) => item.level === "attend" && item.told !== undefined && now - item.told < DAY_MS).length;
}

export function closeSeat(incidents: Incidents, seat: string, now: number): string[] {
  const closed: string[] = [];
  for (const item of Object.values(incidents.items)) {
    if (!item.open || item.seat !== seat) continue;
    item.open = false;
    item.closed = now;
    closed.push(item.id);
  }
  return closed;
}

export function forget(incidents: Incidents, keep = 500): void {
  const done = Object.values(incidents.items)
    .filter((item) => !item.open)
    .sort((a, b) => (a.closed ?? a.last) - (b.closed ?? b.last));
  for (const item of done.slice(0, Math.max(0, done.length - keep))) delete incidents.items[item.id];
}
