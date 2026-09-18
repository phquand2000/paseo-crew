import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "../core/store.ts";

export type LaneStatus = "open" | "closed";
export type TaskStatus = "running" | "done" | "rework" | "queued" | "merging" | "merged" | "failed" | "cut" | "stalled";
/** What an ask is about. The tool schema offers the kinds the SLP preset uses; the ledger carries whatever it is told, because nothing routes on it. */
export type AskKind = string;

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
  /** The lane this one was opened to get out of the way of: a hole found mid-lane gets its own Lead, not a wider lane. */
  detourOf?: string;
  worktree?: string;
  slot?: string;
  writeSet: string[];
  contracts: string[];
  lead?: string;
  workspaceId?: string;
  opener: string;
  status: LaneStatus;
  restoring?: Restoring;
  openedAt: number;
  closedAt?: number;
  tasks: number;
};

export type Handback = { file: string; outcome: string; commit?: string; summary: string; at: number };

export type Task = {
  id: string;
  lane: string;
  kind: "code" | "review";
  mode: "lane" | "parallel";
  of?: string;
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
  /** The merge that brought a parallel task's work into the lane, which outlives its branch and copy. */
  mergeSha?: string;
  status: TaskStatus;
  openedAt: number;
  updatedAt: number;
  handback?: Handback;
  /** How many times this task has been sent back, so each sending is its own event and not a repeat. */
  reworks?: number;
  silent: number;
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
  status: "open" | "answered";
  openedAt: number;
  remindedAt?: number;
  reminders: number;
  escalated?: boolean;
  answer?: string;
};

/** A teardown waiting on the seats still writing in the copy. On the record, so a restart does not lose it. */
export type Releasing = { writers: string[]; dropBranch?: string; into?: string };

/**
 * A lane that worked in the project's own copy, waiting to put its branch back.
 *
 * `branch` is what the copy was left on: a later lane may take that copy before the wait ends, and
 * switching it then would move somebody else's checkout — so the wait only acts on a copy still
 * where it was left. Kept on the lane rather than in memory, because a restart used to lose it and
 * leave the owner's own repository sitting on a dead lane's branch.
 */
export type Restoring = { writers: string[]; base: string; branch: string };

export type Slot = { id: string; path: string; workspaceId?: string; lane?: string; task?: string; createdAt: number; releasing?: Releasing };

export type AgentRef = { id: string; role: string; lane?: string; task?: string; turnStartedAt?: number; recordedAt?: number; spokeAt?: number };

export type Ledger = {
  version: 1;
  seq: { lane: number; ask: number; slot?: number };
  lanes: Record<string, Lane>;
  tasks: Record<string, Task>;
  asks: Record<string, Ask>;
  agents: Record<string, AgentRef>;
  slots: Record<string, Slot>;
};

export function emptyLedger(): Ledger {
  return { version: 1, seq: { lane: 0, ask: 0 }, lanes: {}, tasks: {}, asks: {}, agents: {}, slots: {} };
}

export function ledgerFile(state: string): string {
  return join(state, "ledger.json");
}

/**
 * The ledger, or why it cannot be read — never an empty one standing in for a file that is there.
 *
 * Writes already refused an unreadable ledger, and every read still answered with an empty one, so the
 * status tool, the owner's pages, a Peer's hand-back and the patrol all saw a project with no work on
 * record — the very thing `ledgerFault` exists to stop anyone believing. Absent is still empty.
 */
export function loadLedger(state: string): Ledger {
  const fault = ledgerFault(state);
  if (fault) throw new Error(`${fault}. Nothing was read from it as if the project had no work on record; move it aside or repair it.`);
  const stored = readJson<Ledger | null>(ledgerFile(state), null);
  if (!stored) return emptyLedger();
  return { ...emptyLedger(), ...stored };
}

/**
 * Why the ledger on disk cannot be read, when it is there and cannot.
 *
 * An unreadable file parses as nothing, and nothing looks exactly like a project that has not
 * started yet: every lane, task, ask and the paths of every live working copy would be forgotten,
 * and the next write would put that emptiness on disk. A version this plugin does not know is the
 * likely way in — a newer plugin wrote it and an older one is now running. Absent is not a fault.
 */
export function ledgerFault(state: string): string | undefined {
  const file = ledgerFile(state);
  if (!existsSync(file)) return undefined;
  let stored: unknown;
  try {
    stored = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    return `${file} is there but could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return `${file} does not hold a record`;
  const version = (stored as { version?: unknown }).version;
  if (version !== 1) return `${file} is version ${JSON.stringify(version)}, which this plugin does not know how to read`;
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

export function nextLaneId(ledger: Ledger): string {
  ledger.seq.lane += 1;
  return `L${ledger.seq.lane}`;
}

export function nextTaskId(ledger: Ledger, lane: Lane, kind: Task["kind"]): string {
  lane.tasks += 1;
  return `${lane.id}-${kind === "review" ? "R" : "T"}${lane.tasks}`;
}

/**
 * A name no working copy in the ledger is holding.
 *
 * Counting them would do: release deletes the entry, so with S0 and S1 open and S0 given back the
 * count is 1 and the next copy is named S1 again — over the live record, on the live path, with a
 * second agent sent to a checkout someone else is writing in. One past the highest cannot collide.
 */
/**
 * Never handed out twice. Reusing the highest free number meant a copy the sweep was still removing
 * had the same path as the next one being created, so the sweep could delete a lane's new copy.
 */
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

export function findTask(ledger: Ledger, id: string): Task | undefined {
  return ledger.tasks[id.trim().toUpperCase()];
}

export function findLane(ledger: Ledger, id: string): Lane | undefined {
  return ledger.lanes[id.trim().toUpperCase()];
}

export function laneOfLead(ledger: Ledger, agentId: string): Lane | undefined {
  return Object.values(ledger.lanes).find((lane) => lane.lead === agentId && lane.status === "open");
}

export function taskOfPeer(ledger: Ledger, agentId: string): Task | undefined {
  return Object.values(ledger.tasks).find((task) => task.peer === agentId);
}

export function openAsksTo(ledger: Ledger, agentId: string): Ask[] {
  return Object.values(ledger.asks).filter((ask) => ask.status === "open" && ask.to === agentId);
}

export function openAsksFrom(ledger: Ledger, agentId: string): Ask[] {
  return Object.values(ledger.asks).filter((ask) => ask.status === "open" && ask.from === agentId);
}

export function tasksOf(ledger: Ledger, laneId: string): Task[] {
  return Object.values(ledger.tasks).filter((task) => task.lane === laneId);
}

export const ACTIVE: TaskStatus[] = ["running", "rework", "queued", "merging"];

export function activeTasks(ledger: Ledger, laneId: string): Task[] {
  return tasksOf(ledger, laneId).filter((task) => ACTIVE.includes(task.status));
}

export function slugify(text: string, max = 32): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "") || "work"
  );
}
