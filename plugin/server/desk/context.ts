import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Team } from "../catalog/team.ts";
import type { Kit, RoleSpec } from "../catalog/kit.ts";
import { type Ledger, type Task, ledgerFault, loadLedger, saveLedger } from "./ledger.ts";
import type { Project } from "./project.ts";
import { type Watching, loadWatching, saveWatching } from "./watching.ts";

export type ToolRequest = { id: string; agent: string; role: string; tool: string; args: Record<string, unknown>; cwd: string; at: number };
export type ToolReply = { ok: boolean; text: string };
export type Args = Record<string, unknown>;
export type Caller = { id: string; role: RoleSpec; title: string; project: Project };

export const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
export const strs = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : typeof value === "string" && value.trim() ? [value.trim()] : [];
export const ok = (text: string): ToolReply => ({ ok: true, text });
export const no = (text: string): ToolReply => ({ ok: false, text });
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
export const hash = (...parts: string[]): string => createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 12);

export type CodeIndex = {
  id: string;
  gitExclude: string[];
  open(path: string): Promise<{ ok: boolean; text: string }>;
  sync(path: string): Promise<{ ok: boolean; text: string }>;
};

/** What the outbox did with a letter. "duplicate" means it was dropped as a repeat of one already sent. */
export type Posted = "sent" | "held" | "duplicate";

export type Mailer = { post(letter: { to: string; key: string; text: string }): Promise<Posted> };

export type DeskDeps = {
  kit: Kit;
  outbox: Mailer;
  log: (project: Project, line: string) => void;
  teamFor: (project?: Project) => Team;
  indexesFor: (project: Project) => CodeIndex[];
};

export class DeskContext {
  readonly kit: Kit;
  readonly projects = new Map<string, Project>();
  private readonly readings = new Map<string, string[]>();
  private readonly deps: DeskDeps;
  private readonly locks = new Map<string, Promise<unknown>>();

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

  log(project: Project, line: string): void {
    this.deps.log(project, line);
  }

  ledger<T>(project: Project, change: (ledger: Ledger) => T | Promise<T>): Promise<T> {
    this.projects.set(project.slug, project);
    const previous = this.locks.get(project.slug) ?? Promise.resolve();
    const run = previous.then(async () => {
      const fault = ledgerFault(project.state);
      if (fault) throw new Error(`${fault}. Nothing was written over it; move it aside or repair it, and what the desk has on record is in that file.`);
      const ledger = loadLedger(project.state);
      const result = await change(ledger);
      saveLedger(project.state, ledger);
      return result;
    });
    this.locks.set(project.slug, run.catch(() => undefined));
    return run;
  }

  /**
   * The Watcher's strike table, read and written under a lock of its own.
   *
   * Unlike the ledger this had none, and every writer of it loads, awaits something real — a roster
   * lookup, a letter going out, a patrol step — and then saves a snapshot taken before that await. Two
   * Watchers handed two endings in one mailbox lost a strike between them, two interruptions cost one
   * page of a budget of two, and a digest's settle was overwritten by whatever had loaded before it.
   * Change what you must under here and do anything that awaits the outside world between two calls.
   */
  watching<T>(project: Project, change: (watching: Watching) => { save: Watching; result: T }): Promise<T> {
    this.projects.set(project.slug, project);
    const key = `${project.slug}:watching`;
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(() => {
      const { save, result } = change(loadWatching(project.state));
      saveWatching(project.state, save);
      return result;
    });
    this.locks.set(key, run.catch(() => undefined));
    return run;
  }

  event(project: Project, data: Record<string, unknown>): void {
    try {
      mkdirSync(project.state, { recursive: true });
      appendFileSync(join(project.state, "events.log"), `${JSON.stringify({ at: new Date().toISOString(), ...data })}\n`);
    } catch (error) {
      console.error("seatworks-v2: events.log write failed:", error);
    }
  }

  recordReading(project: Project, where: string, notes: string[]): void {
    this.readings.set(`${project.slug}:${where}`, notes);
  }

  reading(project: Project, where: string): string[] {
    return this.readings.get(`${project.slug}:${where}`) ?? [];
  }

  /** What became of the letter: sent, held for a seat that is busy, or dropped as a repeat of one already sent. */
  async post(to: string | undefined, key: string, text: string): Promise<Posted | "nobody"> {
    if (!to) return "nobody";
    return this.deps.outbox.post({ to, key, text });
  }

  setTask(project: Project, taskId: string, change: (task: Task) => void): Promise<Task | undefined> {
    return this.ledger(project, (ledger) => {
      const task = ledger.tasks[taskId];
      if (!task) return undefined;
      change(task);
      task.updatedAt = Date.now();
      return { ...task };
    });
  }
}
