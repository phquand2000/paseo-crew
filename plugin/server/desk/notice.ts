import type { Finding } from "../runtime/watch/rules.ts";
import { type Incident, closeSeat, forget, sight, spentToday } from "./incidents.ts";
import { type Lane, type Task, laneOfLead, loadLedger, taskOfPeer } from "./ledger.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";

export type Noticed = { id: string; title?: string | null };

export type Placed = { where: string; lane?: Lane; task?: Task };

export function placeOf(project: Project, seat: Noticed): Placed {
  try {
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, seat.id);
    const lane = task ? ledger.lanes[task.lane] : laneOfLead(ledger, seat.id);
    if (task) return { where: `the Peer on ${task.id} (${task.title})`, lane, task };
    if (lane) return { where: `the Lead of ${lane.id} (${lane.title})`, lane };
  } catch {}
  return { where: seat.title ? `${seat.title} (${seat.id})` : seat.id };
}

export async function notice(services: DeskServices, project: Project, seat: Noticed, findings: Finding[], now = Date.now()): Promise<{ opened: Incident[]; place: Placed }> {
  const { ctx } = services;
  const place = placeOf(project, seat);
  if (findings.length === 0) return { opened: [], place };
  for (const finding of findings) {
    ctx.event(project, { kind: "watch.finding", agent: seat.id, finding: finding.kind, level: finding.level, quote: finding.quote, facts: finding.facts, p: finding.p ?? null, model: finding.model ?? null });
  }
  const opened = await ctx.incidents(project, (incidents) => {
    const fresh: Incident[] = [];
    for (const finding of findings) {
      const { incident, opened: isNew } = sight(
        incidents,
        { seat: seat.id, where: place.where, lane: place.lane?.id, task: place.task?.id, kind: finding.kind, level: finding.level, quote: finding.quote, facts: finding.facts, p: finding.p, model: finding.model },
        now,
      );
      if (!isNew) continue;
      ctx.event(project, { kind: "incident.open", id: incident.id, agent: seat.id, finding: incident.kind, level: incident.level });
      fresh.push({ ...incident });
    }
    forget(incidents);
    return fresh;
  });
  return { opened, place };
}

export function closeIncidentsOf(services: DeskServices, project: Project, seat: string, now = Date.now()): Promise<string[]> {
  return services.ctx.incidents(project, (incidents) => closeSeat(incidents, seat, now));
}

export { spentToday };
