import type { Team } from "../catalog/team.ts";
import type { Kit, RoleSpec, SensorSpec } from "../catalog/kit.ts";
import type { Judge } from "../core/ports.ts";
import { LANE, type LaneMove } from "../domain/lane.ts";
import { TASK, type TaskMove, type TaskStatus } from "../domain/task.ts";
import type { DeskEvent } from "./events.ts";
import type { Letter } from "./letters.ts";
import { type Ledger, type Task, ledgerFault, loadLedger, saveLedger } from "./ledger.ts";
import type { Project } from "./project.ts";
import { appendRecord } from "./records.ts";
import { type Incidents, incidentsFault, loadIncidents, saveIncidents } from "./incidents.ts";

export type ToolRequest = { id: string; agent: string; role: string; tool: string; args: Record<string, unknown>; cwd: string; at: number };
export type ToolReply = { ok: boolean; text: string };
export type Args = Record<string, unknown>;
export type Caller = { id: string; role: RoleSpec; title: string; project: Project };

export const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
export const strs = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : typeof value === "string" && value.trim() ? [value.trim()] : [];
/** Only the fields the call names, read as text or as a list: an amendment changes what it is given and nothing else. */
export const given = (args: Args, texts: string[], lists: string[]): Record<string, string | string[]> =>
  Object.fromEntries([...texts.map((key) => [key, str(args[key])] as const), ...lists.map((key) => [key, strs(args[key])] as const)].filter(([key]) => args[key] !== undefined));
export const ok = (text: string): ToolReply => ({ ok: true, text });
export const no = (text: string): ToolReply => ({ ok: false, text });

export type CodeIndex = {
  id: string;
  gitExclude: string[];
  open(path: string): Promise<{ ok: boolean; text: string }>;
  sync(path: string): Promise<{ ok: boolean; text: string }>;
  close(path: string): Promise<{ ok: boolean; text: string }>;
};

/** "duplicate": dropped as a repeat of a letter already sent. */
export type Posted = "sent" | "held" | "duplicate";

export type Mailer = { post(letter: { to: string; key: string; text: string; wakes?: false }): Promise<Posted> };

/** What a transaction returns: never a promise, since awaiting inside one would let another change in between its read and its write. */
export type Sync<T> = T extends PromiseLike<unknown> ? never : T;

type DeskDeps = {
  kit: Kit;
  outbox: Mailer;
  log: (project: Project, line: string) => void;
  teamFor: (project?: Project) => Team;
  indexesFor: (project: Project) => CodeIndex[];
  sensor?: (spec: SensorSpec, key: string) => Judge;
};

export class DeskContext {
  readonly kit: Kit;
  readonly projects = new Map<string, Project>();
  readonly seating = new Set<string>();
  readonly closing = new Set<string>();
  private readonly lines = new Map<string, Promise<unknown>>();
  /** What each seat's last status said: one that asks again with nothing changed is polling. */
  readonly statusSeen = new Map<string, string>();
  private readonly deps: DeskDeps;

  constructor(deps: DeskDeps) {
    this.deps = deps;
    this.kit = deps.kit;
  }

  team(project?: Project): Team {
    return this.deps.teamFor(project);
  }

  indexes(project: Project): CodeIndex[] {
    return this.deps.indexesFor(project);
  }

  /** A sensor asked over HTTP, where the host gave the desk a way to ask one. */
  sensor(spec: SensorSpec, key: string): Judge | undefined {
    return this.deps.sensor?.(spec, key);
  }

  log(project: Project, line: string): void {
    this.deps.log(project, line);
  }

  /** The one way the ledger changes: read, decided on and saved with nothing awaited in between, so no other change can land in the middle. */
  /** Runs `work` once every earlier one queued under `key` has settled, whatever became of it. */
  inTurn<T>(key: string, work: () => Promise<T>): Promise<T> {
    const run = (this.lines.get(key) ?? Promise.resolve()).then(work);
    this.lines.set(key, run.catch(() => undefined));
    return run;
  }

  transact<T>(project: Project, decide: (ledger: Ledger) => Sync<T>): T {
    this.projects.set(project.slug, project);
    const fault = ledgerFault(project.state);
    if (fault) throw new Error(`${fault}. Nothing was written over it. Only the Human can repair it or move it aside — no seat may write the desk's own files — and what the desk has on record is in that file.`);
    const ledger = loadLedger(project.state);
    const result = decide(ledger);
    saveLedger(project.state, ledger);
    return result;
  }

  /** The ledger as it stands. An unreadable one still refuses: read as empty, every copy would look stray. */
  read<T>(project: Project, look: (ledger: Ledger) => T): T {
    const fault = ledgerFault(project.state);
    if (fault) throw new Error(`${fault}. Nothing was read from it as if it were empty.`);
    return look(loadLedger(project.state));
  }

  incidents<T>(project: Project, change: (incidents: Incidents) => Sync<T>): T {
    this.projects.set(project.slug, project);
    const fault = incidentsFault(project.state);
    if (fault) throw new Error(`${fault}. Nothing was written over it. Only the Human can repair it or move it aside.`);
    const incidents = loadIncidents(project.state);
    const result = change(incidents);
    saveIncidents(project.state, incidents);
    return result;
  }

  event(project: Project, data: DeskEvent): void {
    appendRecord(project.state, "events", `${JSON.stringify({ at: new Date().toISOString(), ...data })}\n`);
  }

  async post(to: string | undefined, letter: Letter): Promise<Posted | "nobody"> {
    if (!to) return "nobody";
    return this.deps.outbox.post({ to, ...letter });
  }

  setTask(project: Project, taskId: string, change: (task: Task) => void): Task | undefined {
    return this.transact(project, (ledger) => {
      const task = ledger.tasks[taskId];
      if (!task) return undefined;
      change(task);
      task.updatedAt = Date.now();
      return { ...task };
    });
  }

  /** Moves a task by its lifecycle under the lock, `change` alongside; a move the table refuses changes nothing and comes back as the status that stopped it. */
  moveTask(project: Project, taskId: string, move: TaskMove, change?: (task: Task) => void): Task | TaskStatus | undefined {
    return this.transact(project, (ledger) => {
      const task = ledger.tasks[taskId];
      if (!task) return undefined;
      if (!TASK.move(task, move)) return task.status;
      change?.(task);
      task.updatedAt = Date.now();
      return { ...task };
    });
  }

  /** As `moveTask`, for a lane: a move its table refuses leaves it as it was. */
  moveLane(project: Project, laneId: string, move: LaneMove): void {
    this.transact(project, (ledger) => {
      const lane = ledger.lanes[laneId];
      if (lane) LANE.move(lane, move);
    });
  }
}
