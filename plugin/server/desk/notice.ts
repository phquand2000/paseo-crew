import { seatOf } from "../catalog/kit.ts";
import type { Finding } from "../runtime/watch/rules.ts";
import { type Incident, closeSeat, forget, sight, spentToday } from "./incidents.ts";
import { type Lane, type Task, laneOfLead, loadLedger, taskOfPeer } from "./ledger.ts";
import { errorText } from "./context.ts";
import { letters } from "./letters.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";

export type Noticed = { id: string; provider: string; title?: string | null };

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

export async function notice(services: DeskServices, project: Project, seat: Noticed, findings: Finding[], now = Date.now()): Promise<{ opened: Incident[]; sent: string[]; place: Placed }> {
  const { ctx, roster } = services;
  const place = placeOf(project, seat);
  if (findings.length === 0) return { opened: [], sent: [], place };
  const attention = ctx.team(project).attention;
  for (const finding of findings) {
    ctx.event(project, { kind: "watch.finding", agent: seat.id, finding: finding.kind, level: finding.level, quote: finding.quote, facts: finding.facts, p: finding.p ?? null, model: finding.model ?? null });
  }
  const { opened, sending } = await ctx.incidents(project, (incidents) => {
    const opened: Incident[] = [];
    const sending: Incident[] = [];
    for (const finding of findings) {
      const { incident, opened: isNew } = sight(
        incidents,
        { seat: seat.id, provider: seat.provider, where: place.where, lane: place.lane?.id, task: place.task?.id, kind: finding.kind, level: finding.level, quote: finding.quote, facts: finding.facts, p: finding.p, model: finding.model },
        now,
      );
      if (incident.told !== undefined) continue;
      const held = !attention.watch ? "shadow" : incident.level === "attend" && spentToday(incidents, now) >= attention.incidentsPerDay ? "budget" : undefined;
      if (held) incident.held = held;
      else {
        delete incident.held;
        incident.told = now;
        sending.push({ ...incident });
      }
      if (isNew) {
        ctx.event(project, { kind: "incident.open", id: incident.id, agent: seat.id, finding: incident.kind, level: incident.level, held: incident.held ?? null });
        opened.push({ ...incident });
      }
    }
    forget(incidents);
    return { opened, sending };
  });
  if (sending.length === 0) return { opened, sent: [], place };
  const sent = await deliver(services, project, seat, place, sending, now);
  return { opened, sent, place };
}

async function deliver(services: DeskServices, project: Project, seat: Noticed, place: Placed, sending: Incident[], now: number): Promise<string[]> {
  const { ctx, roster } = services;
  let to: string | undefined;
  try {
    to = await roster.supervisorFor(project, place.lane?.opener);
  } catch (error) {
    ctx.event(project, { kind: "incident.lookup-failed", error: errorText(error) });
  }
  if (!to || to === seat.id) {
    await ctx.incidents(project, (incidents) => {
      for (const sent of sending) {
        const incident = incidents.items[sent.id];
        if (!incident || incident.told !== now) continue;
        delete incident.told;
        incident.held = "nobody";
      }
    });
    for (const sent of sending) ctx.event(project, { kind: "incident.held", id: sent.id, held: "nobody" });
    return [];
  }
  const harness = seatOf(ctx.kit, seat.provider)?.harness;
  const shape = { steers: harness?.steers === true, outputless: Boolean(harness?.exitPattern) };
  for (const incident of sending) {
    try {
      await ctx.post(to, `incident:${project.slug}:${incident.id}:${incident.opened}`, letters.incident(incident, place, shape));
    } catch (error) {
      ctx.event(project, { kind: "incident.post-failed", id: incident.id, error: errorText(error) });
    }
  }
  ctx.event(project, { kind: "incident.told", ids: sending.map((incident) => incident.id), to });
  return sending.map((incident) => incident.id);
}

export async function retell(services: DeskServices, project: Project, now = Date.now()): Promise<string[]> {
  const { ctx } = services;
  if (!ctx.team(project).attention.watch) return [];
  const waiting = await ctx.incidents(project, (incidents) => Object.values(incidents.items).filter((item) => item.open && item.held === "nobody" && item.told === undefined).map((item) => ({ ...item })));
  const told: string[] = [];
  for (const seat of [...new Set(waiting.map((item) => item.seat))]) {
    const mine = waiting.filter((item) => item.seat === seat);
    const noticed = { id: seat, provider: mine[0]!.provider ?? "" };
    const place = placeOf(project, noticed);
    let to: string | undefined;
    try {
      to = await services.roster.supervisorFor(project, place.lane?.opener);
    } catch {}
    if (!to || to === seat) continue;
    const sending = await ctx.incidents(project, (incidents) => {
      const taken: Incident[] = [];
      for (const item of mine) {
        const incident = incidents.items[item.id];
        if (!incident?.open || incident.held !== "nobody" || incident.told !== undefined) continue;
        delete incident.held;
        incident.told = now;
        taken.push({ ...incident });
      }
      return taken;
    });
    if (sending.length > 0) told.push(...(await deliver(services, project, noticed, place, sending, now)));
  }
  return told;
}

export function closeIncidentsOf(services: DeskServices, project: Project, seat: string, now = Date.now()): Promise<string[]> {
  return services.ctx.incidents(project, (incidents) => closeSeat(incidents, seat, now));
}
