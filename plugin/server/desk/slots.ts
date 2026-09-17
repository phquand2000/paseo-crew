import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { addWorktree, branchExists, excludeFromGit, git, isPristine } from "../core/git.ts";
import type { Workspaces } from "../core/ports.ts";
import { worktreeRoot } from "../core/paths.ts";
import type { DeskContext } from "./context.ts";
import { type Slot, loadLedger } from "./ledger.ts";
import { clip } from "./letters.ts";
import type { Project } from "./project.ts";

export type Holder = { lane?: string; task?: string };

export class Slots {
  private readonly ctx: DeskContext;
  private readonly workspaces: Workspaces;

  constructor(ctx: DeskContext, workspaces: Workspaces) {
    this.ctx = ctx;
    this.workspaces = workspaces;
  }

  async acquire(project: Project, branch: string, base: string, holder: Holder): Promise<Slot> {
    const picked = await this.reserve(project, holder);
    if (!picked) throw new Error(`all ${this.ctx.team(project).limits.slots} working copies of this project are in use`);
    try {
      const reused = await this.checkOut(project, picked, branch, base);
      const workspaceId = picked.workspaceId ?? (await this.createWorkspace(project, picked));
      this.ctx.event(project, { kind: "slot.taken", slot: picked.id, branch, ...holder });
      this.index(project, picked, reused);
      return { ...picked, workspaceId };
    } catch (error) {
      await this.free(project, picked.id);
      throw error;
    }
  }

  async release(project: Project, slotId: string | undefined, dropBranch?: string): Promise<void> {
    if (!slotId) return;
    const slot = loadLedger(project.state).slots[slotId];
    if (slot && existsSync(slot.path)) {
      await git(slot.path, ["switch", "--detach"]);
      if (dropBranch) await git(project.root, ["branch", "-D", dropBranch]);
    }
    await this.free(project, slotId);
    this.ctx.event(project, { kind: "slot.released", slot: slotId });
  }

  private reserve(project: Project, holder: Holder): Promise<Slot | undefined> {
    return this.ctx.ledger(project, (ledger) => {
      const free = Object.values(ledger.slots)
        .filter((slot) => !slot.lane && !slot.task)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (free) {
        Object.assign(free, holder);
        return { ...free };
      }
      const count = Object.keys(ledger.slots).length;
      if (count >= this.ctx.team(project).limits.slots) return undefined;
      const id = `S${count}`;
      const slot: Slot = { id, path: join(worktreeRoot(), project.slug, id), createdAt: Date.now(), ...holder };
      ledger.slots[id] = slot;
      return { ...slot };
    });
  }

  private async checkOut(project: Project, slot: Slot, branch: string, base: string): Promise<boolean> {
    if (!(await branchExists(project.root, base))) throw new Error(`the base branch ${base} does not exist`);
    if (await branchExists(project.root, branch)) throw new Error(`the branch ${branch} already exists`);
    if (existsSync(join(slot.path, ".git"))) {
      if (!(await isPristine(slot.path))) throw new Error(`working copy ${slot.id} has uncommitted changes`);
      const run = await git(slot.path, ["switch", "-c", branch, base]);
      if (run.code !== 0) throw new Error(run.stderr.trim() || "git switch failed");
      return true;
    }
    mkdirSync(dirname(slot.path), { recursive: true });
    const added = await addWorktree(project.root, slot.path, branch, base);
    if (!added.ok) throw new Error(added.message);
    return false;
  }

  private async createWorkspace(project: Project, slot: Slot): Promise<string> {
    const workspaceId = await this.workspaces.make(`${project.slug} ${slot.id}`, slot.path);
    await this.ctx.ledger(project, (ledger) => {
      const entry = ledger.slots[slot.id];
      if (entry) entry.workspaceId = workspaceId;
    });
    return workspaceId;
  }

  private free(project: Project, slotId: string): Promise<void> {
    return this.ctx.ledger(project, (ledger) => {
      const entry = ledger.slots[slotId];
      if (entry) {
        delete entry.lane;
        delete entry.task;
      }
    });
  }

  private index(project: Project, slot: Slot, reused: boolean): void {
    for (const index of this.ctx.indexes(project)) {
      for (const pattern of index.gitExclude) excludeFromGit(project.root, pattern);
      const work = index.open(slot.path).then((opened) => (opened.ok && reused ? index.sync(slot.path) : opened));
      void work.then((result) => this.ctx.event(project, { kind: "index.opened", server: index.id, slot: slot.id, reused, ok: result.ok, detail: clip(result.text, 200) }));
    }
  }
}
