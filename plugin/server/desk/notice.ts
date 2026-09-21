import { existsSync } from "node:fs";
import { join } from "node:path";
import { seatOf } from "../catalog/kit.ts";
import { jevOn } from "../catalog/team.ts";
import { KEPT_FILE, assessmentsDir } from "../runtime/watch/jev/assessments.ts";
import type { Attention } from "../catalog/kit.ts";
import type { Finding, Verdict } from "../runtime/watch/findings.ts";
import { confirmable } from "../runtime/watch/jev/rules.ts";
import { type Held, type Incident, type Incidents, closeSeat, forget, openFor, settledAsNoise, sight, spentToday } from "./incidents.ts";
import { type Lane, type Task, laneOfLead, loadLedger, taskOfPeer } from "./ledger.ts";
import { errorText } from "../core/errors.ts";
import { letters } from "./letters.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";

export type Noticed = { id: string; provider: string; title?: string | null };

export type Placed = { where: string; lane?: Lane; task?: Task };

const AWAIT_MS = 120_000;

function waits(services: DeskServices, project: Project): Set<string> {
  const team = services.ctx.team(project);
  return jevOn(team) ? confirmable(team.sensor?.spec.questions ?? {}) : new Set();
}

function holdFor(incident: Incident, incidents: Incidents, attention: Attention, waiting: Set<string>, now: number): Held | undefined {
  if (!attention.watch) return "shadow";
  const judged = incident.level === "attend" && waiting.has(incident.kind);
  if (judged && incident.sensor?.says === "vetoes") return "vetoed";
  if (judged && !incident.sensor && now - incident.last < AWAIT_MS) return "awaiting";
  if (incident.level === "attend" && spentToday(incidents, now) >= attention.incidentsPerDay) return "budget";
  return undefined;
}

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
  const { ctx } = services;
  const place = placeOf(project, seat);
  if (findings.length === 0) return { opened: [], sent: [], place };
  const attention = ctx.team(project).attention;
  const waiting = waits(services, project);
  for (const finding of findings) {
    ctx.event(project, { kind: "watch.finding", agent: seat.id, finding: finding.kind, level: finding.level, quote: finding.quote, facts: finding.facts, p: finding.p ?? null, model: finding.model ?? null });
  }
  const { opened, sending } = await ctx.incidents(project, (incidents) => {
    const opened: Incident[] = [];
    const sending: Incident[] = [];
    for (const finding of findings) {
      const sighting = { seat: seat.id, provider: seat.provider, where: place.where, lane: place.lane?.id, task: place.task?.id, kind: finding.kind, level: finding.level, quote: finding.quote, facts: finding.facts, p: finding.p, model: finding.model };
      if (settledAsNoise(incidents, sighting, now)) continue;
      const { incident, opened: isNew } = sight(incidents, sighting, now);
      if (incident.told !== undefined) continue;
      const held = holdFor(incident, incidents, attention, waiting, now);
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
  // Named only when it is really there: with no key the watch never ran, and with the sensor
  // unreachable it kept nothing, and an incident must not send anyone to a file that does not exist.
  const file = join(assessmentsDir(project.state), KEPT_FILE);
  const kept = existsSync(file) ? file : undefined;
  for (const incident of sending) {
    try {
      await ctx.post(to, `incident:${project.slug}:${incident.id}:${incident.opened}:${incident.level}`, letters.incident(incident, place, shape, kept));
    } catch (error) {
      ctx.event(project, { kind: "incident.post-failed", id: incident.id, error: errorText(error) });
    }
  }
  ctx.event(project, { kind: "incident.told", ids: sending.map((incident) => incident.id), to });
  return sending.map((incident) => incident.id);
}

export async function judge(services: DeskServices, project: Project, seat: Noticed, verdicts: Verdict[], now = Date.now()): Promise<string[]> {
  const { ctx } = services;
  if (verdicts.length === 0) return [];
  const attention = ctx.team(project).attention;
  const waiting = waits(services, project);
  const sending = await ctx.incidents(project, (incidents) => {
    const taken: Incident[] = [];
    for (const verdict of verdicts) {
      const incident = openFor(incidents, seat.id, verdict.kind);
      if (!incident) continue;
      ctx.event(project, { kind: "incident.judged", id: incident.id, agent: seat.id, question: verdict.question, p: verdict.p, says: verdict.says, told: incident.told !== undefined });
      if (incident.told !== undefined) continue;
      incident.sensor = { question: verdict.question, p: verdict.p, model: verdict.model, says: verdict.says };
      const held = holdFor(incident, incidents, attention, waiting, now);
      if (held) incident.held = held;
      else {
        delete incident.held;
        incident.told = now;
        taken.push({ ...incident });
      }
    }
    return taken;
  });
  if (sending.length === 0) return [];
  return deliver(services, project, seat, placeOf(project, seat), sending, now);
}

export async function retell(services: DeskServices, project: Project, now = Date.now()): Promise<string[]> {
  const { ctx } = services;
  const team = ctx.team(project);
  // No key is no watch, so there is nothing to tell later either. Left ungated this was the one path
  // that still spoke with the watch off — and it did not merely carry on: what holds an incident back
  // is read from the sensor's own questions, so with the key gone that set is empty, the hold
  // dissolves, and taking the key away is the very thing that sends the mail. Going to a Watcher seat
  // empties it the same way, so a hold Jev decided is not retold from there either.
  if (!jevOn(team)) return [];
  const attention = team.attention;
  if (!attention.watch) return [];
  const waiting = waits(services, project);
  const told: string[] = [];
  const overdue = await ctx.incidents(project, (incidents) => {
    const taken: Incident[] = [];
    for (const incident of Object.values(incidents.items)) {
      if (!incident.open || incident.told !== undefined || (incident.held !== "awaiting" && incident.held !== "vetoed")) continue;
      const held = holdFor(incident, incidents, attention, waiting, now);
      if (held) incident.held = held;
      else {
        delete incident.held;
        incident.told = now;
        taken.push({ ...incident });
      }
    }
    return taken;
  });
  for (const seat of [...new Set(overdue.map((item) => item.seat))]) {
    const mine = overdue.filter((item) => item.seat === seat);
    const noticed = { id: seat, provider: mine[0]!.provider ?? "" };
    told.push(...(await deliver(services, project, noticed, placeOf(project, noticed), mine, now)));
  }
  const nobody = await ctx.incidents(project, (incidents) => Object.values(incidents.items).filter((item) => item.open && item.held === "nobody" && item.told === undefined).map((item) => ({ ...item })));
  for (const seat of [...new Set(nobody.map((item) => item.seat))]) {
    const mine = nobody.filter((item) => item.seat === seat);
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
