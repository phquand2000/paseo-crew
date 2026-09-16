import { createHash } from "node:crypto";
import type { SeatView } from "../core/paseo.ts";
import type { Ledger } from "./ledger.ts";
import type { Project } from "./project.ts";

export type FlowSeat = { id: string; role: string; status: string; minutes: number; waiting: string[] };
export type FlowTask = { id: string; title: string; status: string; kind: string; peer: FlowSeat | null; minutes: number; handback: number | null };
export type FlowLane = { id: string; title: string; status: string; branch: string; base: string; lead: FlowSeat | null; tasks: FlowTask[] };
export type FlowAsk = { id: string; kind: string; fromRole: string; to: string; minutes: number; text: string };
export type FlowView = { project: string; at: number; revision: string; supervisor: FlowSeat | null; lanes: FlowLane[]; asks: FlowAsk[] };

const minutes = (now: number, at: number | string | undefined): number =>
  at === undefined ? 0 : Math.max(0, Math.round((now - (typeof at === "string" ? Date.parse(at) : at)) / 60_000));

function seatOf(seats: Map<string, SeatView>, id: string | undefined, role: string, now: number): FlowSeat | null {
  if (!id) return null;
  const seat = seats.get(id);
  if (!seat) return { id, role, status: "gone", minutes: 0, waiting: [] };
  return {
    id,
    role,
    status: seat.status,
    minutes: minutes(now, seat.updatedAt),
    waiting: (seat.pendingPermissions ?? []).map((request) => request.title ?? request.name ?? "a request"),
  };
}

export function flowView(project: Project, ledger: Ledger, seats: Map<string, SeatView>, now: number): FlowView {
  const byLane = new Map<string, FlowTask[]>();
  for (const task of Object.values(ledger.tasks)) {
    if (task.status === "merged" || task.status === "cut") continue;
    const built: FlowTask = {
      id: task.id,
      title: task.title,
      status: task.status,
      kind: task.kind,
      peer: seatOf(seats, task.peer, task.kind === "review" ? "reviewer" : "peer", now),
      minutes: minutes(now, task.updatedAt),
      handback: task.handback ? minutes(now, task.handback.at) : null,
    };
    const held = byLane.get(task.lane);
    if (held) held.push(built);
    else byLane.set(task.lane, [built]);
  }

  const lanes: FlowLane[] = [];
  for (const lane of Object.values(ledger.lanes)) {
    if (lane.status !== "open") continue;
    lanes.push({
      id: lane.id,
      title: lane.title,
      status: lane.status,
      branch: lane.branch,
      base: lane.base,
      lead: seatOf(seats, lane.lead, "lead", now),
      tasks: byLane.get(lane.id) ?? [],
    });
  }

  const asks: FlowAsk[] = [];
  for (const ask of Object.values(ledger.asks)) {
    if (ask.status !== "open") continue;
    asks.push({
      id: ask.id,
      kind: ask.kind,
      fromRole: ask.fromRole,
      to: ask.to,
      minutes: minutes(now, ask.openedAt),
      text: ask.text.split(/\r?\n/).find((line) => line.trim()) ?? "",
    });
  }

  let supervisor: FlowSeat | null = null;
  for (const agent of Object.values(ledger.agents)) {
    if (agent.role !== "supervisor") continue;
    supervisor = seatOf(seats, agent.id, "supervisor", now);
    break;
  }

  const body = { project: project.slug, supervisor, lanes, asks };
  const revision = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { ...body, at: now, revision };
}
