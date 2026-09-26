import { DAY_MS } from "../core/time.ts";
import { join } from "node:path";
import { isRecord, readJsonFile, writeJson } from "../core/store.ts";
import { type Held, close } from "../domain/incident.ts";

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
  opened: number;
  last: number;
  count: number;
  open: boolean;
  told?: number;
  toldTo?: "lead" | "supervisor";
  held?: Held;
  label?: "useful" | "noise" | "unknown";
  note?: string;
  closed?: number;
};

export type Incidents = { next: number; items: Record<string, Incident> };

type Sighting = Omit<
  Incident,
  "id" | "opened" | "last" | "count" | "open" | "told" | "held" | "label" | "note" | "closed" | "later"
>;

function incidentsFile(state: string): string {
  return join(state, "incidents.json");
}

const normalized = (stored: Partial<Incidents>): Incidents => ({
  next: Number.isInteger(stored.next) && (stored.next as number) > 0 ? (stored.next as number) : 1,
  items: stored.items && typeof stored.items === "object" ? stored.items : {},
});

/** The book from one read, or why it cannot be read: written over, what it holds would be lost. */
export function readIncidentsFile(state: string): { incidents: Incidents } | { fault: string } {
  const file = incidentsFile(state);
  const read = readJsonFile(file);
  if ("fault" in read) return read;
  if ("absent" in read) return { incidents: normalized({}) };
  if (!isRecord(read.value) || !isRecord(read.value.items))
    return { fault: `${file} does not hold a record of incidents` };
  return { incidents: normalized(read.value) };
}

/** For a view: a book that cannot be read shows as empty. */
export function loadIncidents(state: string): Incidents {
  const read = readJsonFile(incidentsFile(state));
  return normalized("value" in read && isRecord(read.value) ? read.value : {});
}

export function saveIncidents(state: string, incidents: Incidents): void {
  writeJson(incidentsFile(state), incidents);
}

export function openFor(incidents: Incidents, seat: string, kind: string): Incident | undefined {
  return Object.values(incidents.items).find((item) => item.open && item.seat === seat && item.kind === kind);
}

/** Whether this exact sentence was already recorded for this seat and kind, open or closed: the book, not the process, survives a restart. */
export function saidBefore(incidents: Incidents, seat: string, kind: string, quote: string): boolean {
  return Object.values(incidents.items).some(
    (item) => item.seat === seat && item.kind === kind && (item.quote === quote || item.later === quote),
  );
}

/**
 * Already settled as noise on this seat in these exact words: counts the sighting and answers true. `mark_incident` closes
 * an incident, so a standing condition would reopen after every mark. Only at `attend`, only for `noise`.
 */
export function settledAsNoise(incidents: Incidents, sighting: Sighting, now: number): boolean {
  if (sighting.level === "page") return false;
  const marked = Object.values(incidents.items).find(
    (item) =>
      !item.open &&
      item.label === "noise" &&
      item.seat === sighting.seat &&
      item.kind === sighting.kind &&
      item.quote === sighting.quote,
  );
  if (!marked) return false;
  marked.count += 1;
  marked.last = now;
  return true;
}

export function sight(incidents: Incidents, sighting: Sighting, now: number): { incident: Incident; opened: boolean } {
  const seen = openFor(incidents, sighting.seat, sighting.kind);
  if (seen) {
    Object.assign(seen, { facts: [...new Set([...seen.facts, ...sighting.facts])], last: now, count: seen.count + 1 });
    if (seen.told === undefined) seen.quote = sighting.quote;
    else seen.later = sighting.quote;
    return { incident: seen, opened: false };
  }
  const incident: Incident = { ...sighting, id: `I${incidents.next}`, opened: now, last: now, count: 1, open: true };
  incidents.next += 1;
  incidents.items[incident.id] = incident;
  return { incident, opened: true };
}

/** Attention-level incidents about `lane` told in the last day: each lane has a budget of its own, and those about no lane share one. */
export function spentToday(incidents: Incidents, lane: string | undefined, now: number): number {
  return Object.values(incidents.items).filter(
    (item) => item.level === "attend" && item.lane === lane && item.told !== undefined && now - item.told < DAY_MS,
  ).length;
}

const JUDGED = 10;

/** A kind whose last ten marks, noise and useful, were mostly noise; fewer than ten marks judge nothing. */
export function onProbation(incidents: Incidents, kind: string): boolean {
  const marked = Object.values(incidents.items)
    .filter((item) => item.kind === kind && (item.label === "useful" || item.label === "noise"))
    .sort((a, b) => (b.closed ?? b.last) - (a.closed ?? a.last))
    .slice(0, JUDGED);
  return marked.length === JUDGED && marked.filter((item) => item.label === "useful").length / JUDGED < 0.5;
}

export function closeSeat(incidents: Incidents, seat: string, now: number): string[] {
  const closed: string[] = [];
  for (const item of Object.values(incidents.items)) {
    if (item.seat === seat && close(item, now)) closed.push(item.id);
  }
  return closed;
}

const KEEP = 500;

export function forget(incidents: Incidents): void {
  const done = Object.values(incidents.items)
    .filter((item) => !item.open)
    .sort((a, b) => (a.closed ?? a.last) - (b.closed ?? b.last));
  for (const item of done.slice(0, Math.max(0, done.length - KEEP))) delete incidents.items[item.id];
}

/** Why text for `seat` may not go to it: it names or quotes an incident about that seat still open. */
export function repeatsIncident(state: string, seat: string | undefined, ...texts: string[]): string | undefined {
  const flat = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const said = flat(texts.join("\n"));
  // A short quote is a path or a word the sender would use anyway; a long one is the desk's own wording.
  const hit = Object.values(loadIncidents(state).items).find(
    (incident) =>
      incident.open &&
      incident.seat === seat &&
      (new RegExp(`\\b${incident.id}\\b`, "i").test(said) ||
        (incident.quote.length >= 20 && said.includes(flat(incident.quote)))),
  );
  return (
    hit &&
    `That repeats incident ${hit.id} about the seat it goes to. Say what you read in its record, in your own words: a seat told of the watch works to the watch.`
  );
}
