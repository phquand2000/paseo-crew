import type { Team } from "../catalog/team.ts";
import type { SeatView } from "../core/paseo.ts";
import type { Ledger } from "./ledger.ts";
import type { Project, ProjectConfig } from "./project.ts";

export type FlowSeat = { id: string; status: string; minutes: number; waiting: string[] };
export type FlowTask = { id: string; title: string; status: string; kind: string; of: string | null; peer: FlowSeat | null; minutes: number; handback: number | null };
export type FlowLane = { id: string; title: string; status: string; branch: string; base: string; lead: FlowSeat | null; tasks: FlowTask[] };
export type FlowAsk = { id: string; kind: string; from: string; fromRole: string; to: string; lane: string | null; task: string | null; minutes: number; text: string };
export type FlowRole = { id: string; label: string; harness: string; model: string | null; headless: boolean; seats: FlowSeat[] };
export type FlowView = { project: string; root: string; at: number; base: string | null; gate: string | null; roles: FlowRole[]; lanes: FlowLane[]; asks: FlowAsk[] };

const minutes = (now: number, at: number | string | undefined): number =>
  at === undefined ? 0 : Math.max(0, Math.round((now - (typeof at === "string" ? Date.parse(at) : at)) / 60_000));

function seatOf(seats: Map<string, SeatView>, id: string | undefined, now: number): FlowSeat | null {
  if (!id) return null;
  const seat = seats.get(id);
  if (!seat) return { id, status: "gone", minutes: 0, waiting: [] };
  return {
    id,
    status: seat.status,
    minutes: minutes(now, seat.updatedAt),
    waiting: (seat.pendingPermissions ?? []).map((request) => request.title ?? request.name ?? "a request"),
  };
}

export function flowView(project: Project, ledger: Ledger, config: ProjectConfig, team: Team, seats: Map<string, SeatView>, now: number): FlowView {
  const lanes = Object.values(ledger.lanes)
    .filter((lane) => lane.status === "open")
    .map((lane) => ({
      id: lane.id,
      title: lane.title,
      status: lane.status,
      branch: lane.branch,
      base: lane.base,
      lead: seatOf(seats, lane.lead, now),
      tasks: Object.values(ledger.tasks)
        .filter((task) => task.lane === lane.id)
        .map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          kind: task.kind,
          of: task.of ?? null,
          peer: seatOf(seats, task.peer, now),
          minutes: minutes(now, task.updatedAt),
          handback: task.handback ? minutes(now, task.handback.at) : null,
        })),
    }));

  const working = new Map<string, string[]>();
  for (const agent of Object.values(ledger.agents)) working.set(agent.role, [...(working.get(agent.role) ?? []), agent.id]);

  const roles = Object.entries(team.roles).map(([id, seat]) => ({
    id,
    label: seat.role.label,
    harness: seat.harness.id,
    model: seat.model?.id ?? null,
    headless: Boolean(seat.role.headless),
    seats: (working.get(id) ?? []).flatMap((agent) => {
      const found = seatOf(seats, agent, now);
      return found ? [found] : [];
    }),
  }));

  const asks = Object.values(ledger.asks)
    .filter((ask) => ask.status === "open")
    .map((ask) => ({
      id: ask.id,
      kind: ask.kind,
      from: ask.from,
      fromRole: ask.fromRole,
      to: ask.to,
      lane: ask.lane ?? null,
      task: ask.task ?? null,
      minutes: minutes(now, ask.openedAt),
      text: ask.text.split(/\r?\n/).find((line) => line.trim()) ?? "",
    }));

  return { project: project.slug, root: project.root, at: now, base: config.base ?? null, gate: config.gate ?? null, roles, lanes, asks };
}
