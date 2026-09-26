import type { Ask } from "./ask.ts";
import type { Lane } from "./lane.ts";
import type { Question } from "./question.ts";
import { ACTIVE, SETTLED, type Task } from "./task.ts";

/** A teardown waiting on the seats still writing in the copy. On the record, so a restart does not lose it. */
type Releasing = { writers: string[]; dropBranch?: string; into?: string };

/** A working copy the desk made, and the lane or task it is for. */
export type Slot = {
  id: string;
  path: string;
  workspaceId?: string;
  lane?: string;
  task?: string;
  createdAt: number;
  releasing?: Releasing;
};

/** A seat's binding: its role, the lane or task it works on, and when it was last heard from. */
export type AgentRef = {
  id: string;
  role: string;
  lane?: string;
  task?: string;
  gone?: boolean;
  recordedAt?: number;
  spokeAt?: number;
};

/** A project's whole record of work: every lane, task, ask, question, seat binding and copy, and the id sequences. */
export type Ledger = {
  seq: { lane: number; ask: number; slot?: number; question?: number };
  lanes: Record<string, Lane>;
  tasks: Record<string, Task>;
  asks: Record<string, Ask>;
  questions: Record<string, Question>;
  agents: Record<string, AgentRef>;
  slots: Record<string, Slot>;
};

export function emptyLedger(): Ledger {
  return { seq: { lane: 0, ask: 0 }, lanes: {}, tasks: {}, asks: {}, questions: {}, agents: {}, slots: {} };
}

export function nextLaneId(ledger: Ledger): string {
  ledger.seq.lane += 1;
  return `L${ledger.seq.lane}`;
}

export function nextTaskId(lane: Lane, kind: Task["kind"]): string {
  if (kind === "review") {
    lane.reviews = (lane.reviews ?? 0) + 1;
    return `${lane.id}-R${lane.reviews}`;
  }
  lane.tasks += 1;
  return `${lane.id}-T${lane.tasks}`;
}

/** Never handed out twice: a reused id gave a copy the sweep was removing the same path as the next one created. */
export function nextSlotId(ledger: Ledger): string {
  const taken = Object.keys(ledger.slots)
    .map((id) => Number(id.replace(/^S/, "")))
    .filter((n) => Number.isInteger(n));
  const next = Math.max(ledger.seq.slot ?? -1, ...taken) + 1;
  ledger.seq.slot = next;
  return `S${next}`;
}

export function nextAskId(ledger: Ledger): string {
  ledger.seq.ask += 1;
  return `A${ledger.seq.ask}`;
}

export function nextQuestionId(ledger: Ledger): string {
  ledger.seq.question = (ledger.seq.question ?? 0) + 1;
  return `H${ledger.seq.question}`;
}

export function findTask(ledger: Ledger, id: string): Task | undefined {
  return ledger.tasks[id.trim().toUpperCase()];
}

export function findLane(ledger: Ledger, id: string): Lane | undefined {
  return ledger.lanes[id.trim().toUpperCase()];
}

export function laneOfLead(ledger: Ledger, agentId: string): Lane | undefined {
  return Object.values(ledger.lanes).find((lane) => lane.lead === agentId && lane.status === "open");
}

/** The lane a seat leads by its binding, closed ones included: a Lead kept after its lane closed still answers for it. */
export function leadLaneOf(ledger: Ledger, agentId: string): Lane | undefined {
  const lane = ledger.lanes[ledger.agents[agentId]?.lane ?? ""];
  return lane?.lead === agentId ? lane : undefined;
}

/** The seats working in a lane: its Lead, then the Peer or reviewer of each task not yet settled. */
export function laneSeats(ledger: Ledger, lane: Lane): { seat: string; task?: Task }[] {
  const working = Object.values(ledger.tasks).filter(
    (task) => task.lane === lane.id && task.peer && !SETTLED.includes(task.status),
  );
  return [...(lane.lead ? [{ seat: lane.lead }] : []), ...working.map((task) => ({ seat: task.peer!, task }))];
}

/** The task a Peer or reviewer is on: its binding names it, and it has no other. */
export function taskOfPeer(ledger: Ledger, agentId: string): Task | undefined {
  const task = ledger.tasks[ledger.agents[agentId]?.task ?? ""];
  return task?.peer === agentId ? task : undefined;
}

export function openAsksTo(ledger: Ledger, agentId: string): Ask[] {
  return Object.values(ledger.asks).filter((ask) => ask.status === "open" && ask.to === agentId);
}

export function openAsksFrom(ledger: Ledger, agentId: string): Ask[] {
  return Object.values(ledger.asks).filter((ask) => ask.status === "open" && ask.from === agentId);
}

/** The lane in the project's own copy: an open one without a copy of its own, or a closed one whose Lead is still ending a turn there. */
export function ownCopyHolder(lanes: Lane[]): Lane | undefined {
  return lanes.find((lane) => lane.status === "open" && !lane.slot) ?? lanes.find((lane) => lane.restoring);
}

export function tasksOf(ledger: Ledger, laneId: string): Task[] {
  return Object.values(ledger.tasks).filter((task) => task.lane === laneId);
}

/** The tasks of `task`'s lane other than it still to be merged or cut. */
export function othersLeft(ledger: Ledger, task: Task): Task[] {
  return tasksOf(ledger, task.lane).filter((entry) => entry.id !== task.id && !SETTLED.includes(entry.status));
}

export function activeTasks(ledger: Ledger, laneId: string): Task[] {
  return tasksOf(ledger, laneId).filter((task) => ACTIVE.includes(task.status));
}
