import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Team } from "../catalog/team.ts";
import type { Kit, RoleSpec } from "../catalog/kit.ts";
import { type Ledger, type Task, ledgerFault, loadLedger, saveLedger } from "./ledger.ts";
import type { Project } from "./project.ts";
import { type Incidents, incidentsFault, loadIncidents, saveIncidents } from "./incidents.ts";
import type { Sent } from "../runtime/watch/seat/reader.ts";

export type ToolRequest = { id: string; agent: string; role: string; tool: string; args: Record<string, unknown>; cwd: string; at: number };
export type ToolReply = { ok: boolean; text: string };
export type Args = Record<string, unknown>;
export type Caller = { id: string; role: RoleSpec; title: string; project: Project };

export const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
export const strs = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : typeof value === "string" && value.trim() ? [value.trim()] : [];
export const ok = (text: string): ToolReply => ({ ok: true, text });
export const no = (text: string): ToolReply => ({ ok: false, text });
export const hash = (...parts: string[]): string => createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 12);

export type CodeIndex = {
  id: string;
  gitExclude: string[];
  open(path: string): Promise<{ ok: boolean; text: string }>;
  sync(path: string): Promise<{ ok: boolean; text: string }>;
  close(path: string): Promise<{ ok: boolean; text: string }>;
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
  /** The step a Watcher was sent under a ref; undefined when it was not, or the desk has restarted since. */
  sent?: (watcher: string, ref: string) => Sent | undefined;
};

export class DeskContext {
  readonly kit: Kit;
  readonly projects = new Map<string, Project>();
  private readonly deps: DeskDeps;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(deps: DeskDeps) {
    this.deps = deps;
    this.kit = deps.kit;
  }

  team(project?: Project): Team {
    return this.deps.teamFor(project);
  }

  sent(watcher: string, ref: string): Sent | undefined {
    return this.deps.sent?.(watcher, ref);
  }

  indexes(project: Project): CodeIndex[] {
    return this.deps.indexesFor(project);
  }

  log(project: Project, line: string): void {
    this.deps.log(project, line);
  }

  /**
   * The one place work on a project is put in line behind the work already running on it.
   *
   * Spelled out at each of its callers, a fourth method could line up behind a different key and
   * nobody would see it: what keeps two writers off one ledger is that they name the same key here.
   */
  private under<T>(key: string, run: () => T | Promise<T>): Promise<T> {
    const waiting = this.locks.get(key) ?? Promise.resolve();
    const next = waiting.then(() => run());
    this.locks.set(key, next.then(() => undefined, () => undefined));
    return next;
  }

  ledger<T>(project: Project, change: (ledger: Ledger) => T | Promise<T>): Promise<T> {
    this.projects.set(project.slug, project);
    return this.under(project.slug, async () => {
      const fault = ledgerFault(project.state);
      if (fault) throw new Error(`${fault}. Nothing was written over it. Only the Human can repair it or move it aside — no seat may write the desk's own files — and what the desk has on record is in that file.`);
      const ledger = loadLedger(project.state);
      const result = await change(ledger);
      saveLedger(project.state, ledger);
      return result;
    });
  }

  /**
   * Read the ledger in turn with its writers, and write nothing back.
   *
   * The sweep has to decide what is live in the same breath as it lists the directory, and doing that
   * through `ledger` rewrote the file on every patrol round for no change at all — and created one for
   * a project that had never opened a lane. An unreadable ledger still refuses: read as empty, every
   * working copy on disk would look like a stray.
   */
  read<T>(project: Project, look: (ledger: Ledger) => T): Promise<T> {
    return this.under(project.slug, () => {
      const fault = ledgerFault(project.state);
      if (fault) throw new Error(`${fault}. Nothing was read from it as if it were empty.`);
      return look(loadLedger(project.state));
    });
  }

  incidents<T>(project: Project, change: (incidents: Incidents) => T): Promise<T> {
    this.projects.set(project.slug, project);
    return this.under(`${project.slug}:incidents`, () => {
      const fault = incidentsFault(project.state);
      if (fault) throw new Error(`${fault}. Nothing was written over it. Only the Human can repair it or move it aside.`);
      const incidents = loadIncidents(project.state);
      const result = change(incidents);
      saveIncidents(project.state, incidents);
      return result;
    });
  }

  event(project: Project, data: Record<string, unknown>): void {
    try {
      mkdirSync(project.state, { recursive: true });
      appendFileSync(join(project.state, "events.log"), `${JSON.stringify({ at: new Date().toISOString(), ...data })}\n`);
    } catch (error) {
      console.error("seatworks-v2: events.log write failed:", error);
    }
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
