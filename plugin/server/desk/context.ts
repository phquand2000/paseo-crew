import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Team } from "../catalog/team.ts";
import { type Kit, type RoleSpec, type TeamRole, seatOf } from "../catalog/kit.ts";
import { type PaseoApi, openSeats } from "../core/paseo.ts";
import { type Ledger, type Task, loadLedger, saveLedger } from "./ledger.ts";
import { type Project, projectOf } from "./project.ts";

export type ToolRequest = { id: string; agent: string; role: string; tool: string; args: Record<string, unknown>; cwd: string; at: number };
export type ToolReply = { ok: boolean; text: string };
export type Args = Record<string, unknown>;
export type Caller = { id: string; role: RoleSpec; team: TeamRole; title: string; project: Project };

export const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
export const strs = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : typeof value === "string" && value.trim() ? [value.trim()] : [];
export const ok = (text: string): ToolReply => ({ ok: true, text });
export const no = (text: string): ToolReply => ({ ok: false, text });
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
export const hash = (...parts: string[]): string => createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 12);

export type IdeClient = {
  open(path: string): Promise<{ ok: boolean; text: string }>;
  sync(path: string): Promise<{ ok: boolean; text: string }>;
};

export type Mailer = { post(paseo: PaseoApi, letter: { to: string; key: string; text: string }): Promise<unknown> };

export type DeskDeps = {
  kit: Kit;
  outbox: Mailer;
  log: (project: Project, line: string) => void;
  teamFor: (project?: Project) => Team;
  ideFor: (project: Project) => IdeClient | null;
};

export class DeskContext {
  readonly kit: Kit;
  readonly projects = new Map<string, Project>();
  readonly pendingArchive = new Set<string>();
  private readonly deps: DeskDeps;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(deps: DeskDeps) {
    this.deps = deps;
    this.kit = deps.kit;
  }

  team(project?: Project): Team {
    return this.deps.teamFor(project);
  }

  ide(project: Project): IdeClient | null {
    return this.deps.ideFor(project);
  }

  log(project: Project, line: string): void {
    this.deps.log(project, line);
  }

  ledger<T>(project: Project, change: (ledger: Ledger) => T | Promise<T>): Promise<T> {
    this.projects.set(project.slug, project);
    const previous = this.locks.get(project.slug) ?? Promise.resolve();
    const run = previous.then(async () => {
      const ledger = loadLedger(project.state);
      const result = await change(ledger);
      saveLedger(project.state, ledger);
      return result;
    });
    this.locks.set(project.slug, run.catch(() => undefined));
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

  async post(paseo: PaseoApi, to: string | undefined, key: string, text: string): Promise<void> {
    if (!to) return;
    await this.deps.outbox.post(paseo, { to, key, text });
  }

  async supervisorFor(paseo: PaseoApi, project: Project, preferred?: string): Promise<string | undefined> {
    if (preferred) {
      try {
        const handle = paseo.agents.ref(preferred);
        await handle.refresh();
        if (!handle.archivedAt) return preferred;
      } catch {}
    }
    const found = (await openSeats(paseo))
      .filter((seat) => seatOf(this.kit, seat.provider)?.role.team === "supervisor" && projectOf(seat.cwd).slug === project.slug)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return found[0]?.id ?? preferred;
  }

  async archive(paseo: PaseoApi, agentId: string | undefined, force = false): Promise<void> {
    if (!agentId) return;
    try {
      const handle = paseo.agents.ref(agentId);
      if (!force) {
        await handle.refresh();
        if (handle.status === "running" || handle.status === "initializing") {
          this.pendingArchive.add(agentId);
          return;
        }
      }
      this.pendingArchive.delete(agentId);
      await handle.archive();
    } catch (error) {
      console.error(`seatworks-v2: archiving ${agentId} failed:`, error);
    }
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
