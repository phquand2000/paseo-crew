import { statSync } from "node:fs";
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
  status: TaskStatus;
  openedAt: number;
  updatedAt: number;
  handback?: Handback;
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

export type Slot = { id: string; path: string; workspaceId?: string; lane?: string; task?: string; createdAt: number };

export type AgentRef = { id: string; role: string; lane?: string; task?: string; turnStartedAt?: number; recordedAt?: number };

export type Ledger = {
  version: 1;
  seq: { lane: number; ask: number };
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

export function loadLedger(state: string): Ledger {
  const stored = readJson<Ledger | null>(ledgerFile(state), null);
  if (!stored || stored.version !== 1) return emptyLedger();
  return { ...emptyLedger(), ...stored };
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
export function nextSlotId(ledger: Ledger): string {
  const taken = Object.keys(ledger.slots)
    .map((id) => Number(id.replace(/^S/, "")))
    .filter((n) => Number.isInteger(n));
  return `S${Math.max(-1, ...taken) + 1}`;
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
