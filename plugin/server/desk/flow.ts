import { createHash } from "node:crypto";
import type { SeatView } from "../core/paseo.ts";
import type { Ledger } from "./ledger.ts";
import type { Project } from "./project.ts";

export type FlowSeat = { id: string; role: string; status: string; minutes: number; waiting: string[] };
export type FlowTask = { id: string; title: string; status: string; kind: string; peer: FlowSeat | null; minutes: number; handback: number | null };
export type FlowLane = { id: string; title: string; status: string; branch: string; base: string; lead: FlowSeat | null; tasks: FlowTask[]; taskCount: number; running: number; open: boolean };
export type FlowAsk = { id: string; kind: string; fromRole: string; to: string; minutes: number; text: string };
export type FlowView = { project: string; at: number; revision: string; supervisors: FlowSeat[]; lanes: FlowLane[]; moreLanes: number; asks: FlowAsk[] };

/** A lane costs a row; its tasks cost a row each. Only the lanes the screen has opened carry tasks. */
export const LANE_CAP = 50;

const minutes = (now: number, at: number | string | undefined): number =>
  at === undefined ? 0 : Math.max(0, Math.round((now - (typeof at === "string" ? Date.parse(at) : at)) / 60_000));

function seatOf(seats: Map<string, SeatView>, id: string | undefined, role: string, now: number, heard?: number): FlowSeat | null {
  if (!id) return null;
  const seat = seats.get(id);
  // How long since it was last heard from, when the desk knows; stamped zero, a seat gone for a week
  // read as having gone just now.
  if (!seat) return { id, role, status: "gone", minutes: heard ? minutes(now, heard) : 0, waiting: [] };
  return {
    id,
    role,
    status: seat.status,
    minutes: minutes(now, seat.updatedAt),
    waiting: (seat.pendingPermissions ?? []).map((request) => request.title ?? request.name ?? "a request"),
  };
}

/**
 * `seated` is every open seat on this project that can supervise, newest first, with its role — asked
 * of the roster by the caller, because a seat is on the ledger's record only once a tool call of its
 * has succeeded, and a Supervisor that had just sat down was otherwise never the one shown.
 */
export function flowView(
  project: Project,
  ledger: Ledger,
  seats: Map<string, SeatView>,
  now: number,
  open: ReadonlySet<string> = new Set(),
  cap: number = LANE_CAP,
  supervises: ReadonlySet<string> = new Set(),
  seated: { id: string; role: string }[] = [],
): FlowView {
  const counts = new Map<string, { total: number; running: number }>();
  const held = new Map<string, FlowTask[]>();

  for (const task of Object.values(ledger.tasks)) {
    if (task.status === "merged" || task.status === "cut") continue;
    const count = counts.get(task.lane) ?? { total: 0, running: 0 };
    count.total += 1;
    if (task.status === "running" || task.status === "rework") count.running += 1;
    counts.set(task.lane, count);
    if (!open.has(task.lane)) continue;
    const built: FlowTask = {
      id: task.id,
      title: task.title,
      status: task.status,
      kind: task.kind,
      peer: seatOf(seats, task.peer, ledger.agents[task.peer ?? ""]?.role ?? task.kind, now),
      minutes: minutes(now, task.updatedAt),
      handback: task.handback ? minutes(now, task.handback.at) : null,
    };
    const list = held.get(task.lane);
    if (list) list.push(built);
    else held.set(task.lane, [built]);
  }

  const lanes: FlowLane[] = [];
  let moreLanes = 0;
  for (const lane of Object.values(ledger.lanes)) {
    if (lane.status !== "open") continue;
    if (lanes.length >= cap) {
      moreLanes += 1;
      continue;
    }
    const count = counts.get(lane.id) ?? { total: 0, running: 0 };
    lanes.push({
      id: lane.id,
      title: lane.title,
      status: lane.status,
      branch: lane.branch,
      base: lane.base,
      lead: seatOf(seats, lane.lead, ledger.agents[lane.lead ?? ""]?.role ?? "lead", now),
      tasks: held.get(lane.id) ?? [],
      taskCount: count.total,
      running: count.running,
      open: open.has(lane.id),
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

  // The Supervisor that is seated now, not the first one ever recorded here. `ledger.agents` is
  // appended to and never pruned, and its keys come back in insertion order, so this named the
  // oldest Supervisor that had ever called a tool on the project — permanently, and as "gone" from
  // the moment that seat was archived, with the one actually working never shown at all.
  const recorded = Object.values(ledger.agents).filter((agent) => supervises.has(agent.role));
  const live = recorded
    .filter((agent) => seats.has(agent.id))
    .sort((a, b) => Date.parse(seats.get(b.id)!.updatedAt) - Date.parse(seats.get(a.id)!.updatedAt));
  // Every seat supervising the project, not one: the concept has several, each for its own concern,
  // and a view with room for one hid all but the busiest. A concern with nobody seated shows the last
  // seat it had, as gone, so the screen says the concern is uncovered rather than saying nothing.
  const shown = new Map<string, FlowSeat>();
  const heard = (id: string) => ledger.agents[id]?.recordedAt;
  for (const entry of [...seated, ...live]) if (!shown.has(entry.id)) shown.set(entry.id, seatOf(seats, entry.id, entry.role, now, heard(entry.id))!);
  const covered = new Set([...shown.values()].map((seat) => seat.role));
  for (const agent of [...recorded].reverse()) {
    if (covered.has(agent.role)) continue;
    covered.add(agent.role);
    shown.set(agent.id, seatOf(seats, agent.id, agent.role, now, heard(agent.id))!);
  }
  const supervisors = [...shown.values()];

  const body = { project: project.slug, supervisors, lanes, moreLanes, asks };
  const revision = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { ...body, at: now, revision };
}
