import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "../core/store.ts";
import { errorText } from "../core/errors.ts";
import type { AskStatus } from "../domain/ask.ts";
import type { Question } from "../domain/question.ts";
import type { LaneStatus } from "../domain/lane.ts";
import { ACTIVE, SETTLED, type TaskStatus } from "../domain/task.ts";

/** Free-form: the ledger carries whatever it is told, because nothing routes on it. */
export type AskKind = string;
/** What a change replaced, kept so the record says what the work was asked before it was asked again. */
export type Amendment = { at: number; by: string; why: string; was: Record<string, string | string[]> };

export type Lane = {
  id: string;
  title: string;
  outcome: string;
  acceptance: string[];
  appetite?: string;
  deadline?: string;
  outOfScope: string[];
  issue?: string;
  base: string;
  branch: string;
  detourOf?: string;
  onBranch?: boolean;
  /** Where an onBranch lane's own commits begin: the branch it carries on had history before it. */
  startSha?: string;
  worktree?: string;
  slot?: string;
  writeSet: string[];
  contracts: string[];
  lead?: string;
  workspaceId?: string;
  opener: string;
  status: LaneStatus;
  after?: string[];
  opening?: { isolate?: boolean; role?: string };
  held?: { why: string; tried?: boolean };
  /** Stopped by whoever supervises it: its seats read nothing, and nothing starts or lands, until it is resumed. */
  onHold?: { at: number; by: string; reason: string };
  /** When its Lead last reported it ready; an amendment takes it away, since what it was ready against has changed. */
  ready?: { at: number };
  /** A landing held for the Human, for the lane branch at `head`; approved, it lands without being asked again while that holds. */
  landApproval?: { since: number; head: string; signals: string[]; evidence: string[]; overGate: boolean; approved?: { at: number; note: string } };
  landed?: boolean;
  closedAt?: number;
  amended?: Amendment[];
  restoring?: Restoring;
  landing?: { by: string; writers: string[] };
  openedAt: number;
  tasks: number;
  reviews?: number;
};

type Handback = { file: string; outcome: string; commit?: string; summary: string; at: number; gate?: { ok: boolean; note: string } };

export type Task = {
  id: string;
  lane: string;
  kind: "code" | "review";
  mode: "lane" | "parallel";
  of?: string;
  /** A review's questions from the risk rules its change reaches: its verdict answers each, in order. */
  asked?: string[];
  title: string;
  goal: string;
  acceptance: string[];
  owned: string[];
  outOfScope: string[];
  context?: string;
  skills?: string[];
  peer?: string;
  branch?: string;
  worktree?: string;
  slot?: string;
  startSha?: string;
  mergeSha?: string;
  status: TaskStatus;
  openedAt: number;
  updatedAt: number;
  handback?: Handback;
  after?: string[];
  opening?: { role: string; fresh?: boolean };
  held?: { why: string; tried?: boolean };
  amended?: Amendment[];
  reworks?: number;
  acceptedAt?: number;
  silent: number;
  peerGone?: boolean;
};

export type Ask = {
  id: string;
  from: string;
  fromRole: string;
  to: string;
  lane?: string;
  task?: string;
  kind: AskKind;
  text: string;
  default?: string;
  status: AskStatus;
  openedAt: number;
  remindedAt?: number;
  reminders: number;
  escalated?: boolean;
  answer?: string;
};

/** A teardown waiting on the seats still writing in the copy. On the record, so a restart does not lose it. */
type Releasing = { writers: string[]; dropBranch?: string; into?: string };

/** A lane in the project's own copy waiting to put its branch back; it acts only on a copy still on `branch`, since a later lane may own it. */
type Restoring = { writers: string[]; base: string; branch: string; landed?: boolean };

export type Slot = { id: string; path: string; workspaceId?: string; lane?: string; task?: string; createdAt: number; releasing?: Releasing };

export type AgentRef = { id: string; role: string; lane?: string; task?: string; team?: string; gone?: boolean; startedAs?: string; recordedAt?: number; spokeAt?: number };

export type Ledger = {
  seq: { lane: number; ask: number; slot?: number; question?: number; team?: number; peers?: Record<string, number> };
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

function ledgerFile(state: string): string {
  return join(state, "ledger.json");
}

/** The ledger, or throws why it cannot be read: never an empty one standing in for a file that is there. Absent is empty. */
export function loadLedger(state: string): Ledger {
  const fault = ledgerFault(state);
  if (fault) throw new Error(`${fault}. Nothing was read from it as if the project had no work on record. Only the Human can repair it or move it aside; no seat may write the desk's own files.`);
  const stored = readJson<Ledger | null>(ledgerFile(state), null);
  if (!stored) return emptyLedger();
  return { ...emptyLedger(), ...stored };
}

/** Why the ledger on disk cannot be read: parsed as nothing, the next write would erase the project. Absent is not a fault. */
export function ledgerFault(state: string): string | undefined {
  const file = ledgerFile(state);
  if (!existsSync(file)) return undefined;
  let stored: unknown;
  try {
    stored = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    return `${file} is there but could not be read: ${errorText(error)}`;
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return `${file} does not hold a record`;
  return undefined;
}

export function saveLedger(state: string, ledger: Ledger): void {
  cached.delete(state);
  writeJson(ledgerFile(state), ledger);
}

const cached = new Map<string, { mtimeMs: number; size: number; ledger: Ledger }>();

export function readLedger(state: string): Ledger {
  let stamp: { mtimeMs: number; size: number };
  try {
    stamp = statSync(ledgerFile(state));
  } catch {
    cached.delete(state);
    return emptyLedger();
  }
  const hit = cached.get(state);
  if (hit && hit.mtimeMs === stamp.mtimeMs && hit.size === stamp.size) return hit.ledger;
  const ledger = loadLedger(state);
  cached.set(state, { mtimeMs: stamp.mtimeMs, size: stamp.size, ledger });
  return ledger;
}

/** Sets what `changes` gives and keeps what it replaced in the entry's history; undefined when nothing would change. */
export function amend(entry: Lane | Task, changes: Record<string, string | string[]>, by: string, why: string, at = Date.now()): Amendment | undefined {
  const fields = entry as unknown as Record<string, string | string[]>;
  const was: Amendment["was"] = {};
  for (const [field, value] of Object.entries(changes)) {
    if (JSON.stringify(fields[field]) === JSON.stringify(value)) continue;
    was[field] = fields[field]!;
    fields[field] = value;
  }
  if (Object.keys(was).length === 0) return undefined;
  const amendment = { at, by, why, was };
  entry.amended = [...(entry.amended ?? []), amendment];
  return amendment;
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
  const working = Object.values(ledger.tasks).filter((task) => task.lane === lane.id && task.peer && !SETTLED.includes(task.status));
  return [...(lane.lead ? [{ seat: lane.lead }] : []), ...working.map((task) => ({ seat: task.peer!, task }))];
}

/** The lane on hold that this seat works in, as its Lead, a Peer or a reviewer; none where the ledger cannot be read. */
export function laneOnHold(state: string, agentId: string): Lane | undefined {
  let ledger: Ledger;
  try {
    ledger = loadLedger(state);
  } catch {
    return undefined;
  }
  const lane = ledger.lanes[ledger.agents[agentId]?.lane ?? ""];
  return lane?.onHold && lane.status !== "closed" ? lane : undefined;
}

/** The task a Peer or reviewer is on now: its binding names it, and one Peer can carry a lane's tasks in turn. */
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

/** The tasks of `task`'s lane other than it still to be accepted or cut. */
export function othersLeft(ledger: Ledger, task: Task): Task[] {
  return tasksOf(ledger, task.lane).filter((entry) => entry.id !== task.id && !SETTLED.includes(entry.status));
}

export function activeTasks(ledger: Ledger, laneId: string): Task[] {
  return tasksOf(ledger, laneId).filter((task) => ACTIVE.includes(task.status));
}
