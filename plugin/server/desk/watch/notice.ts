import { recordEvent } from "../store/event-log.ts";
import type { Attention } from "../../../shared/views.ts";
import { seatOf } from "../../catalog/kit/roles.ts";
import { type Finding, type Held, deliveryOf, hold, tell, unheard } from "../../domain/incident.ts";
import { type Moment, momentCases } from "./checks.ts";
import {
  type Incident,
  type Incidents,
  closeSeat,
  forget,
  onProbation,
  settledAsNoise,
  sight,
  spentToday,
} from "../store/incidents.ts";
import { judge } from "./judging.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { laneOfLead, taskOfPeer } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { errorText } from "../../core/errors.ts";
import { watchLetters } from "../letters/watch-letters.ts";
import { pageIncident } from "./pager.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";

export type Noticed = { id: string; provider: string; title?: string | null };

type Placed = { where: string; lane?: Lane; task?: Task };

/** A page is irreversible and often done already, so it reaches whoever supervises whatever the switch, the marks or the budget say. */
function holdFor(incident: Incident, incidents: Incidents, attention: Attention, now: number): Held | undefined {
  if (incident.level === "page") return undefined;
  if (!attention.watch) return "shadow";
  if (onProbation(incidents, incident.kind)) return "probation";
  if (spentToday(incidents, incident.lane, now) >= attention.incidentsPerLane) return "budget";
  return undefined;
}

function placeOf(project: Project, seat: Noticed): Placed {
  try {
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, seat.id);
    const lane = task ? ledger.lanes[task.lane] : laneOfLead(ledger, seat.id);
    if (task) return { where: `the Peer on ${task.id} (${task.title})`, lane, task };
    if (lane) return { where: `the Lead of ${lane.id} (${lane.title})`, lane };
  } catch {
    // A ledger that cannot be read leaves the seat named by its title alone.
  }
  return { where: seat.title ? `${seat.title} (${seat.id})` : seat.id };
}

/** What the watch saw of a seat: the findings that open incidents, and the moment they came from, which the watch's questions read. */
export async function notice(
  services: DeskServices,
  project: Project,
  seat: Noticed,
  findings: Finding[],
  moment?: Moment,
  now = Date.now(),
): Promise<{ opened: Incident[]; sent: string[]; place: Placed }> {
  const place = placeOf(project, seat);
  for (const found of moment ? momentCases(services.kit, place, moment) : []) void judge(services, project, found);
  if (findings.length === 0) return { opened: [], sent: [], place };
  for (const finding of findings) {
    recordEvent(project, {
      kind: "watch.finding",
      agent: seat.id,
      finding: finding.kind,
      level: finding.level,
      quote: finding.quote,
      facts: finding.facts,
    });
  }
  const { opened, sending } = openIncidents(services, project, seat, place, findings, now);
  const sent = sending.length > 0 ? await deliver(services, project, seat, place, sending, now) : [];
  // Once, as it opens: a page is irreversible and often done already, so the Human hears of it whoever else does.
  for (const incident of opened.filter((item) => item.level === "page"))
    await pageIncident(services, project, incident, place.where, place.lane, sent.includes(incident.id));
  return { opened, sent, place };
}

/** Opens or sights an incident for each finding not settled as noise, and holds it where attention says so, else tells it. */
function openIncidents(
  { incidents, teamFor }: Pick<DeskServices, "incidents" | "teamFor">,
  project: Project,
  seat: Noticed,
  place: Placed,
  findings: Finding[],
  now: number,
): { opened: Incident[]; sending: Incident[] } {
  const attention = teamFor(project).attention;
  return incidents.transact(project, (book) => {
    const opened: Incident[] = [];
    const sending: Incident[] = [];
    for (const finding of findings) {
      const sighting = {
        seat: seat.id,
        provider: seat.provider,
        where: place.where,
        lane: place.lane?.id,
        task: place.task?.id,
        kind: finding.kind,
        level: finding.level,
        quote: finding.quote,
        facts: finding.facts,
      };
      if (settledAsNoise(book, sighting, now)) continue;
      const { incident, opened: isNew } = sight(book, sighting, now);
      if (deliveryOf(incident) === "told") continue;
      const held = holdFor(incident, book, attention, now);
      if (held) hold(incident, held);
      else if (tell(incident, now)) sending.push({ ...incident });
      if (isNew) {
        recordEvent(project, {
          kind: "incident.open",
          id: incident.id,
          agent: seat.id,
          finding: incident.kind,
          level: incident.level,
          held: incident.held ?? null,
        });
        opened.push({ ...incident });
      }
    }
    forget(book);
    return { opened, sending };
  });
}

type Reader = "lead" | "supervisor";

/** Attention-level incidents about a Peer go to its Lead; the rest, or a Peer with no Lead, to whoever supervises. Never to the seat itself. */
async function recipientFor(
  services: DeskServices,
  project: Project,
  seat: Noticed,
  place: Placed,
  level: Incident["level"],
): Promise<{ to: string | undefined; as: Reader }> {
  const lead = place.lane?.lead;
  if (level === "attend" && place.task && lead && lead !== seat.id && (await services.roster.seated(lead)))
    return { to: lead, as: "lead" };
  const to = await services.roster.supervisorFor(project, place.lane?.opener);
  return { to: to === seat.id ? undefined : to, as: "supervisor" };
}

async function deliver(
  services: DeskServices,
  project: Project,
  seat: Noticed,
  place: Placed,
  sending: Incident[],
  now: number,
): Promise<string[]> {
  const { kit, incidents, mail } = services;
  const harness = seatOf(kit, seat.provider)?.harness;
  const steers = harness?.steers === true;
  const told: string[] = [];
  for (const level of ["page", "attend"] as const) {
    const batch = sending.filter((incident) => incident.level === level);
    if (batch.length === 0) continue;
    let reader: { to: string | undefined; as: Reader } = { to: undefined, as: "supervisor" };
    try {
      reader = await recipientFor(services, project, seat, place, level);
    } catch (error) {
      recordEvent(project, { kind: "incident.lookup-failed", error: errorText(error) });
    }
    const { to, as } = reader;
    if (!to) {
      incidents.transact(project, (incidents) => {
        for (const sent of batch) {
          const incident = incidents.items[sent.id];
          if (incident?.told === now) unheard(incident);
        }
      });
      for (const sent of batch) recordEvent(project, { kind: "incident.held", id: sent.id, held: "nobody" });
      continue;
    }
    incidents.transact(project, (incidents) => {
      for (const sent of batch) {
        const incident = incidents.items[sent.id];
        if (incident?.told === now) incident.toldTo = as;
      }
    });
    for (const incident of batch) {
      try {
        await mail.post(to, watchLetters.incident(incident, place, steers, as));
      } catch (error) {
        recordEvent(project, { kind: "incident.post-failed", id: incident.id, error: errorText(error) });
      }
    }
    recordEvent(project, { kind: "incident.told", ids: batch.map((incident) => incident.id), to });
    told.push(...batch.map((incident) => incident.id));
  }
  return told;
}

export async function retell(services: DeskServices, project: Project, now = Date.now()): Promise<string[]> {
  const { incidents, teamFor } = services;
  const { watch } = teamFor(project).attention;
  const told: string[] = [];
  const nobody = incidents.transact(project, (incidents) =>
    Object.values(incidents.items)
      .filter(
        (item) => item.open && item.held === "nobody" && item.told === undefined && (watch || item.level === "page"),
      )
      .map((item) => ({ ...item })),
  );
  for (const seat of [...new Set(nobody.map((item) => item.seat))]) {
    const noticed = { id: seat, provider: nobody.find((item) => item.seat === seat)!.provider ?? "" };
    const place = placeOf(project, noticed);
    // Only what somebody is now seated to read; `deliver` then finds that somebody again, per level.
    const mine: Incident[] = [];
    for (const level of ["page", "attend"] as const) {
      const some = nobody.filter((item) => item.seat === seat && item.level === level);
      if (some.length === 0) continue;
      try {
        if ((await recipientFor(services, project, noticed, place, level)).to) mine.push(...some);
      } catch {
        // Nobody could be looked up: these stay held for nobody until a later round finds someone.
      }
    }
    if (mine.length === 0) continue;
    const sending = incidents.transact(project, (incidents) => {
      const taken: Incident[] = [];
      for (const item of mine) {
        const incident = incidents.items[item.id];
        if (incident?.open && incident.held === "nobody" && tell(incident, now)) taken.push({ ...incident });
      }
      return taken;
    });
    if (sending.length > 0) told.push(...(await deliver(services, project, noticed, place, sending, now)));
  }
  return told;
}

export function closeIncidentsOf(services: DeskServices, project: Project, seat: string, now = Date.now()): string[] {
  return services.incidents.transact(project, (incidents) => closeSeat(incidents, seat, now));
}
