import { minutesSince } from "../../core/time.ts";
import { createHash } from "node:crypto";
import type { SeatView } from "../../core/paseo.ts";
import { AT_WORK, SETTLED } from "../../domain/task.ts";
import { keptCopy, keptPeers } from "../seats/kept.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { FlowAsk, FlowLane, FlowQuestion, FlowSeat, FlowTask, FlowView } from "../../../shared/views.ts";
import type { Project } from "../project.ts";

const LANE_CAP = 50;

const minutes = (now: number, at: number | string | undefined): number =>
  at === undefined ? 0 : minutesSince(now, at);

function seatOf(
  seats: Map<string, SeatView>,
  id: string | undefined,
  role: string,
  now: number,
  heard?: number,
): FlowSeat | null {
  if (!id) return null;
  const seat = seats.get(id);
  // Stamped zero, a seat gone for a week read as gone just now.
  if (!seat) return { id, role, status: "gone", minutes: heard ? minutes(now, heard) : 0, waiting: [] };
  return {
    id,
    role,
    status: seat.status,
    minutes: minutes(now, seat.updatedAt),
    waiting: (seat.pendingPermissions ?? []).map((request) => request.title ?? request.name ?? "a request"),
  };
}

type Counted = { total: number; running: number };

/** Every lane's count of unsettled tasks, and the tasks themselves for the lanes the panel has open. */
function tasksByLane(
  ledger: Ledger,
  seats: Map<string, SeatView>,
  now: number,
  open: ReadonlySet<string>,
): { counts: Map<string, Counted>; held: Map<string, FlowTask[]> } {
  const counts = new Map<string, Counted>();
  const held = new Map<string, FlowTask[]>();
  for (const task of Object.values(ledger.tasks)) {
    if (SETTLED.includes(task.status)) continue;
    const count = counts.get(task.lane) ?? { total: 0, running: 0 };
    count.total += 1;
    if (AT_WORK.includes(task.status)) count.running += 1;
    counts.set(task.lane, count);
    if (!open.has(task.lane)) continue;
    const peer = seatOf(seats, task.peer, ledger.agents[task.peer ?? ""]?.role ?? task.kind, now);
    const built: FlowTask = {
      id: task.id,
      title: task.title,
      status: task.status,
      kind: task.kind,
      mode: task.mode,
      copy: task.mode === "parallel" ? (task.slot ?? null) : null,
      after: task.after ?? [],
      held: task.held?.why ?? null,
      peer,
      minutes: minutes(now, task.updatedAt),
      handback: task.handback ? minutes(now, task.handback.at) : null,
    };
    held.set(task.lane, [...(held.get(task.lane) ?? []), built]);
  }
  return { counts, held };
}

function laneOf(
  lane: Lane,
  ledger: Ledger,
  seats: Map<string, SeatView>,
  now: number,
  count: Counted,
  tasks: FlowTask[],
  open: boolean,
): FlowLane {
  const land = lane.landApproval;
  const closed = lane.status === "closed";
  const idle = closed ? [] : keptPeers(ledger, lane.id).filter((peer) => seats.has(peer.id));
  return {
    id: lane.id,
    title: lane.title,
    status: lane.status,
    branch: lane.branch,
    ...(lane.onBranch ? {} : { base: lane.base }),
    copy: (closed ? keptCopy(ledger, lane) : lane.slot) ?? null,
    lead: seatOf(seats, lane.lead, ledger.agents[lane.lead ?? ""]?.role ?? "lead", now),
    kept: idle.map((peer) => ({ ...seatOf(seats, peer.id, peer.role, now)!, task: peer.task! })),
    ...(closed ? { landed: Boolean(lane.landed) } : {}),
    tasks,
    taskCount: count.total,
    running: count.running,
    open,
    ...(lane.status === "waiting" ? { after: lane.after ?? [], ...(lane.held ? { held: lane.held.why } : {}) } : {}),
    ...(land
      ? {
          landApproval: {
            minutes: minutes(now, land.since),
            approved: Boolean(land.approved),
            signals: land.signals,
            evidence: land.evidence,
          },
        }
      : {}),
    ...(lane.workspaceId ? { workspaceId: lane.workspaceId } : {}),
    ...(lane.onHold ? { onHold: { minutes: minutes(now, lane.onHold.at), reason: lane.onHold.reason } } : {}),
    ...(lane.ready ? { ready: minutes(now, lane.ready.at) } : {}),
  };
}

function asksOf(ledger: Ledger, now: number): FlowAsk[] {
  return Object.values(ledger.asks)
    .filter((ask) => ask.status === "open")
    .map((ask) => ({
      id: ask.id,
      kind: ask.kind,
      fromRole: ask.fromRole,
      to: ask.to,
      minutes: minutes(now, ask.openedAt),
      text: ask.text.split(/\r?\n/).find((line) => line.trim()) ?? "",
    }));
}

/** The Human's open questions, which the panel is where they answer. */
function questionsOf(ledger: Ledger, now: number): FlowQuestion[] {
  return Object.values(ledger.questions)
    .filter((question) => question.status === "open")
    .map(({ id, question, why, lane, class: kind, options, recommend, reason, ifSilent, openedAt }) => ({
      id,
      question,
      why,
      lane: lane ?? null,
      class: kind,
      options,
      recommend,
      reason,
      ifSilent,
      minutes: minutes(now, openedAt),
    }));
}

/** Every supervising seat, one per concern; a concern with nobody seated shows its last seat as gone. */
function supervisorsOf(
  ledger: Ledger,
  seats: Map<string, SeatView>,
  now: number,
  supervises: ReadonlySet<string>,
  seated: { id: string; role: string }[],
): FlowSeat[] {
  // The Supervisor seated now: `ledger.agents` keeps each role's newest gone seat, so its first entry may be archived.
  const recorded = Object.values(ledger.agents).filter((agent) => supervises.has(agent.role));
  const live = recorded
    .filter((agent) => seats.has(agent.id))
    .sort((a, b) => Date.parse(seats.get(b.id)!.updatedAt) - Date.parse(seats.get(a.id)!.updatedAt));
  const shown = new Map<string, FlowSeat>();
  const heard = (id: string) => ledger.agents[id]?.recordedAt;
  for (const entry of [...seated, ...live])
    if (!shown.has(entry.id)) shown.set(entry.id, seatOf(seats, entry.id, entry.role, now, heard(entry.id))!);
  const covered = new Set([...shown.values()].map((seat) => seat.role));
  for (const agent of [...recorded].reverse()) {
    if (covered.has(agent.role)) continue;
    covered.add(agent.role);
    shown.set(agent.id, seatOf(seats, agent.id, agent.role, now, heard(agent.id))!);
  }
  return [...shown.values()];
}

/** `seated` comes from the roster: the ledger records a seat only after its first successful tool call. */
export function flowView(
  project: Project,
  ledger: Ledger,
  seats: Map<string, SeatView>,
  now: number,
  open: ReadonlySet<string> = new Set(),
  supervises: ReadonlySet<string> = new Set(),
  seated: { id: string; role: string }[] = [],
): Omit<FlowView, "watch"> {
  const { counts, held } = tasksByLane(ledger, seats, now, open);
  // A closed lane stays live while its Lead is kept, until the Supervisor releases it or the Human archives it.
  const active = Object.values(ledger.lanes).filter(
    (lane) => lane.status !== "closed" || (lane.lead !== undefined && seats.has(lane.lead)),
  );
  const lanes = active
    .slice(0, LANE_CAP)
    .map((lane) =>
      laneOf(
        lane,
        ledger,
        seats,
        now,
        counts.get(lane.id) ?? { total: 0, running: 0 },
        held.get(lane.id) ?? [],
        open.has(lane.id),
      ),
    );
  const body = {
    project: project.slug,
    supervisors: supervisorsOf(ledger, seats, now, supervises, seated),
    lanes,
    moreLanes: Math.max(0, active.length - LANE_CAP),
    asks: asksOf(ledger, now),
    questions: questionsOf(ledger, now),
  };
  const revision = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { ...body, at: now, revision };
}
