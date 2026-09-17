import { existsSync, mkdirSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { addWorktree, branchExists, excludeFromGit, git, isPristine, removeWorktree } from "../core/git.ts";
import type { Workspaces } from "../core/ports.ts";
import { worktreeRoot } from "../core/paths.ts";
import type { DeskContext } from "./context.ts";
import { type Ledger, type Slot, loadLedger, nextSlotId } from "./ledger.ts";
import { clip } from "./letters.ts";
import type { Project } from "./project.ts";

export type Holder = { lane?: string; task?: string };

/** What putting a lane's copy away means: the copy itself if it had one, the project's branch if not. */
export type Teardown = { project: Project; slot?: string; dropBranch?: string; restore?: string };

export class Slots {
  private readonly ctx: DeskContext;
  private readonly workspaces: Workspaces;
  private readonly held = new Map<string, { teardown: Teardown; writers: Set<string> }>();

  constructor(ctx: DeskContext, workspaces: Workspaces) {
    this.ctx = ctx;
    this.workspaces = workspaces;
  }

  async acquire(project: Project, branch: string, base: string, holder: Holder): Promise<Slot> {
    const picked = await this.reserve(project, holder);
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

  async inPlace(project: Project, branch: string, base: string): Promise<{ path: string; workspaceId: string }> {
    if (!(await isPristine(project.root))) {
      throw new Error("the project's own working copy has uncommitted changes, so a lane cannot take it over; commit or stash them, or open the lane with isolate true");
    }
    if (await branchExists(project.root, branch)) throw new Error(`the branch ${branch} already exists`);
    const run = await git(project.root, ["switch", "-c", branch, base]);
    if (run.code !== 0) throw new Error(run.stderr.trim() || "git switch failed");
    const workspaceId = await this.projectWorkspace(project);
    this.index(project, { id: "main", path: project.root, createdAt: Date.now() }, true);
    this.ctx.event(project, { kind: "lane.inPlace", branch, base });
    return { path: project.root, workspaceId };
  }

  async projectWorkspace(project: Project): Promise<string> {
    const kept = await this.workspaces.named(project.slug).catch(() => undefined);
    return kept ?? (await this.workspaces.make(project.slug, project.root));
  }

  async restore(project: Project, base: string): Promise<void> {
    if (!(await isPristine(project.root))) return;
    await git(project.root, ["switch", base]);
  }

  /**
   * Puts a lane's working copy away, or waits for the seats still writing in it to stop.
   *
   * A seat whose archive was deferred to the end of its turn is still writing: removing its copy
   * --force takes the work it has not committed, dropping the branch takes the work it has, and
   * switching the project's own copy back to base lets its next commit land on base. So the
   * teardown waits with it, and runs when the last writer there stops.
   */
  async putAway(teardown: Teardown, writers: string[] = []): Promise<string | undefined> {
    if (writers.length === 0 || (!teardown.slot && !teardown.restore)) return this.run(teardown);
    this.held.set(teardown.slot ?? teardown.project.slug, { teardown, writers: new Set(writers) });
    this.ctx.event(teardown.project, { kind: "slot.heldOpen", slot: teardown.slot ?? "in place", writers });
    return undefined;
  }

  /** Finishes what a seat's own turn was holding up, once nothing else is writing in that copy. */
  async stopped(agentId: string): Promise<void> {
    for (const [key, entry] of [...this.held]) {
      if (!entry.writers.delete(agentId) || entry.writers.size > 0) continue;
      this.held.delete(key);
      await this.run(entry.teardown);
    }
  }

  private run(teardown: Teardown): Promise<string | undefined> {
    if (teardown.slot) return this.release(teardown.project, teardown.slot, teardown.dropBranch);
    if (teardown.restore) return this.restore(teardown.project, teardown.restore).then(() => undefined);
    return Promise.resolve(undefined);
  }

  /** Returns the branch it was asked to drop and kept, because the work on it is not in anything. */
  async release(project: Project, slotId: string | undefined, dropBranch?: string): Promise<string | undefined> {
    if (!slotId) return undefined;
    const slot = loadLedger(project.state).slots[slotId];
    let kept: string | undefined;
    if (slot) {
      if (existsSync(slot.path)) {
        await git(slot.path, ["switch", "--detach"]);
        await removeWorktree(project.root, slot.path);
      }
      // -d, not -D: a branch git will not delete is one holding commits nothing else has, and a cut
      // task's commits are all the Peer leaves behind. Clutter is cheaper than deleting them.
      if (dropBranch && (await git(project.root, ["branch", "-d", dropBranch])).code !== 0) kept = dropBranch;
      if (slot.workspaceId) {
        try {
          await this.workspaces.archive(slot.workspaceId);
        } catch (error) {
          this.ctx.log(project, `workspace ${slot.workspaceId} could not be put away: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    await this.drop(project, slotId);
    this.ctx.event(project, { kind: "slot.released", slot: slotId, removed: Boolean(slot), kept });
    return kept;
  }

  private reserve(project: Project, holder: Holder): Promise<Slot> {
    return this.ctx.ledger(project, (ledger) => {
      const free = Object.values(ledger.slots)
        .filter((slot) => !slot.lane && !slot.task)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (free) {
        Object.assign(free, holder);
        return { ...free };
      }
      const id = nextSlotId(ledger);
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

  async sweep(project: Project, ledger: Ledger, busy = false): Promise<void> {
    const held = new Set<string>();
    for (const slot of Object.values(ledger.slots)) if (slot.workspaceId) held.add(slot.workspaceId);
    for (const lane of Object.values(ledger.lanes)) if (lane.status === "open" && lane.workspaceId) held.add(lane.workspaceId);
    for (const workspace of await this.workspaces.owned(project.slug)) {
      if (held.has(workspace.id) || (busy && workspace.name === project.slug)) continue;
      try {
        await this.workspaces.archive(workspace.id);
        this.ctx.event(project, { kind: "workspace.swept", workspace: workspace.id, name: workspace.name });
      } catch (error) {
        this.ctx.log(project, `workspace ${workspace.name} could not be swept: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const root = join(worktreeRoot(), project.slug);
    if (!root.startsWith(worktreeRoot()) || !existsSync(root)) return;
    const live = new Set(Object.values(ledger.slots).map((slot) => slot.path));
    for (const name of readdirSync(root)) {
      const path = join(root, name);
      if (live.has(path)) continue;
      await removeWorktree(project.root, path);
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {}
      this.ctx.event(project, { kind: "worktree.swept", path });
    }
    try {
      if (readdirSync(root).length === 0) rmdirSync(root);
    } catch {}
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

  private drop(project: Project, slotId: string): Promise<void> {
    return this.ctx.ledger(project, (ledger) => {
      delete ledger.slots[slotId];
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
