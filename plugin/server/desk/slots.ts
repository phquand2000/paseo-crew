import { existsSync, mkdirSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { addWorktree, branchExists, cleanState, currentBranch, dropMerged, git, mergeUnderWay, pristineState, removeWorktree } from "../core/git.ts";
import type { Workspace, Workspaces } from "../core/ports.ts";
import { worktreeRoot } from "../core/paths.ts";
import type { DeskContext } from "./context.ts";
import { closeIndexes, openIndexes } from "./indexes.ts";
import { sweepCopies } from "./sweep.ts";
import { type Slot, loadLedger, nextSlotId } from "./ledger.ts";
import type { Project } from "./project.ts";
import { errorText } from "../core/errors.ts";

type Holder = { lane?: string; task?: string };

/** What putting a lane's copy away means: the copy itself if it had one, the project's branch if not. */
type Teardown = { project: Project; slot?: string; dropBranch?: string; into?: string; restore?: string; lane?: string; branch?: string };

export class Slots {
  private readonly ctx: DeskContext;
  private readonly workspaces: Workspaces;

  constructor(ctx: DeskContext, workspaces: Workspaces) {
    this.ctx = ctx;
    this.workspaces = workspaces;
  }

  /** `work` is what the copy is taken for, as its workspace is named: a lane or a task, its id and title. */
  async acquire(project: Project, branch: string, base: string, holder: Holder, work: string): Promise<Slot> {
    const picked = this.reserve(project, holder);
    try {
      const reused = await this.checkOut(project, picked, branch, base);
      const workspaceId = await this.workspaceFor(project, picked, work);
      this.ctx.event(project, { kind: "slot.taken", slot: picked.id, branch, ...holder });
      openIndexes(this.ctx, project, picked, reused);
      return { ...picked, workspaceId };
    } catch (error) {
      this.free(project, picked.id);
      throw error;
    }
  }

  async inPlace(project: Project, branch: string, base: string): Promise<{ path: string; workspaceId: string }> {
    const copy = await pristineState(project.root);
    if (copy !== "clean") {
      throw new Error(
        copy === "dirty"
          ? "the project's own working copy has uncommitted changes, so a lane cannot take it over; ask the Human to commit or stash them, or open the lane with isolate true"
          : `git could not read the project's own working copy at ${project.root}, so a lane cannot take it over`,
      );
    }
    if (await branchExists(project.root, branch)) throw new Error(`the branch ${branch} already exists`);
    const run = await git(project.root, ["switch", "-c", branch, base]);
    if (run.code !== 0) throw new Error(run.stderr.trim() || "git switch failed");
    try {
      const taken = await this.takeOwnCopy(project);
      this.ctx.event(project, { kind: "lane.inPlace", branch, base });
      return taken;
    } catch (error) {
      await this.giveBack(project, base, branch);
      throw error;
    }
  }

  /** Carries on the branch the project's own copy is on, or first starts `branch` from `from` there with the uncommitted work along. */
  async carryOn(project: Project, branch: string, from?: string): Promise<{ path: string; workspaceId: string }> {
    if (from) {
      const run = await git(project.root, ["switch", "-c", branch]);
      if (run.code !== 0) throw new Error(run.stderr.trim() || "git switch failed");
    }
    try {
      const taken = await this.takeOwnCopy(project);
      this.ctx.event(project, { kind: "lane.onBranch", branch, ...(from ? { from } : {}) });
      return taken;
    } catch (error) {
      if (from) await this.unstart(project, from, branch);
      throw error;
    }
  }

  /** Undoes a branch `carryOn` started: it holds no commit yet, so the copy goes back to `from` with the uncommitted work and the branch is dropped. */
  async unstart(project: Project, from: string, branch: string): Promise<void> {
    if ((await currentBranch(project.root)) !== branch) return;
    const run = await git(project.root, ["switch", from]);
    if (run.code !== 0) {
      this.ctx.log(project, `the project's own copy could not go back from ${branch} to ${from}: ${run.stderr.trim() || `git switch exited ${run.code}`}`);
      return;
    }
    await dropMerged(project.root, branch, from);
    this.ctx.event(project, { kind: "lane.unstarted", branch, from });
  }

  private async takeOwnCopy(project: Project): Promise<{ path: string; workspaceId: string }> {
    const workspaceId = (await this.projectWorkspace(project)).id;
    openIndexes(this.ctx, project, { id: "main", path: project.root }, true);
    return { path: project.root, workspaceId };
  }

  /** Undoes what `inPlace` did to the owner's repository: a lane failing mid-open has no slot id for `openLane` to clean up through. */
  async giveBack(project: Project, base: string, branch: string): Promise<void> {
    if (!(await this.restore(project, base, branch))) return;
    // Nothing committed on it: the branch is the desk's litter, and `release` keeps the other case for the Human.
    await dropMerged(project.root, branch, base);
    this.ctx.event(project, { kind: "lane.gaveBack", branch, base });
  }

  async projectWorkspace(project: Project): Promise<Workspace> {
    const kept = await this.workspaces.named(project.slug).catch(() => undefined);
    return kept ?? (await this.workspaces.make(project.slug, project.root));
  }

  /**
   * Puts the project's own copy back on base and says whether it is there. A copy a later lane now owns counts as done; every
   * other failure is logged, since the caller has already dropped the parked record. `carry` takes work uncommitted along.
   */
  async restore(project: Project, base: string, left?: string, carry = false): Promise<boolean> {
    if (left && (await currentBranch(project.root)) !== left) return true;
    // One under way here is the desk's own, left for the lane to settle: no seat may begin one, and the lane is closing without it.
    if (await mergeUnderWay(project.root)) await git(project.root, ["merge", "--abort"]);
    const copy = carry ? "clean" : await cleanState(project.root);
    if (copy !== "clean") {
      const why = copy === "dirty" ? "it has uncommitted changes" : "git could not read it";
      this.ctx.log(project, `the project's own working copy is still on ${left ?? "a lane branch"} and not back on ${base}: ${why}`);
      this.ctx.event(project, { kind: "restore.held", base, branch: left ?? null, why: copy });
      return false;
    }
    const run = await git(project.root, ["switch", base]);
    if (run.code !== 0) {
      this.ctx.log(project, `the project's own working copy could not go back to ${base}: ${run.stderr.trim() || `git switch exited ${run.code}`}`);
      this.ctx.event(project, { kind: "restore.held", base, branch: left ?? null, why: "switch-failed" });
      return false;
    }
    return true;
  }

  /** Puts a lane's copy away, or waits for the seats still writing in it: removing or switching it under them loses their work. */
  async putAway(teardown: Teardown, writers: string[] = []): Promise<string | undefined> {
    const waiting = [...new Set(writers)];
    if (waiting.length === 0 || (!teardown.slot && !teardown.restore)) return this.run(teardown);
    if (teardown.slot) {
      this.ctx.transact(teardown.project, (ledger) => {
        const slot = ledger.slots[teardown.slot!];
        if (slot) slot.releasing = { writers: waiting, dropBranch: teardown.dropBranch, into: teardown.into };
      });
    } else if (teardown.lane) {
      this.ctx.transact(teardown.project, (ledger) => {
        const lane = ledger.lanes[teardown.lane!];
        if (lane) lane.restoring = { writers: waiting, base: teardown.restore!, branch: teardown.branch ?? lane.branch, ...(teardown.into ? { into: teardown.into } : {}) };
      });
    }
    this.ctx.event(teardown.project, { kind: "slot.heldOpen", slot: teardown.slot ?? "in place", writers: waiting });
    return undefined;
  }

  /** Finishes what the seats' own turns were holding up, once nothing else is writing in that copy. */
  async stopped(ended: (agentId: string) => boolean): Promise<void> {
    for (const project of this.ctx.projects.values()) await this.finish(project, ended);
  }

  /** A writer that is no longer a seat has stopped for good: after an archive, crash or restart its turn-end never comes. */
  reap(project: Project, live: Set<string>): Promise<void> {
    return this.finish(project, (id) => !live.has(id));
  }

  private async finish(project: Project, stopped: (agentId: string) => boolean): Promise<void> {
    const ledger = loadLedger(project.state);
    // A record with nobody left to wait for is a restore that did not happen, retried each time.
    const due = (writers: string[]) => writers.length === 0 || writers.some(stopped);
    for (const lane of Object.values(ledger.lanes).filter((entry) => entry.restoring && due(entry.restoring.writers))) {
      const restoring = this.ctx.transact(project, (current) => {
        const entry = current.lanes[lane.id]?.restoring;
        return entry && this.leftToWait(entry, stopped);
      });
      // The record goes only once the copy is really back: it is the only token a later round can retry from.
      if (!restoring || !(await this.restore(project, restoring.base, restoring.branch, lane.onBranch))) continue;
      if (restoring.into) await dropMerged(project.root, restoring.branch, restoring.into);
      this.ctx.transact(project, (current) => {
        const entry = current.lanes[lane.id];
        if (entry) delete entry.restoring;
      });
    }
    for (const slot of Object.values(ledger.slots).filter((entry) => entry.releasing && entry.releasing.writers.some(stopped))) {
      const releasing = this.ctx.transact(project, (current) => {
        const entry = current.slots[slot.id]?.releasing;
        return entry && entry.writers.length > 0 ? this.leftToWait(entry, stopped) : undefined;
      });
      if (releasing) await this.release(project, slot.id, releasing.dropBranch, releasing.into);
    }
  }

  /** Drops the writers that have stopped from a wait as it stands in the ledger; the wait comes back once nobody is left in it. */
  private leftToWait<T extends { writers: string[] }>(wait: T, stopped: (agentId: string) => boolean): T | undefined {
    const left = wait.writers.filter((id) => !stopped(id));
    wait.writers = left;
    return left.length === 0 ? { ...wait } : undefined;
  }

  private run(teardown: Teardown): Promise<string | undefined> {
    if (teardown.slot) return this.release(teardown.project, teardown.slot, teardown.dropBranch, teardown.into);
    if (teardown.restore) {
      const carry = teardown.lane ? loadLedger(teardown.project.state).lanes[teardown.lane]?.onBranch : undefined;
      // Recorded as a wait for nobody when it fails, so the round retries it and Detach sees it.
      return this.restore(teardown.project, teardown.restore, teardown.branch, carry).then(async (back) => {
        if (back && teardown.dropBranch && teardown.into) await dropMerged(teardown.project.root, teardown.dropBranch, teardown.into);
        if (back || !teardown.lane) return undefined;
        this.ctx.transact(teardown.project, (ledger) => {
          const lane = ledger.lanes[teardown.lane!];
          if (lane) lane.restoring = { writers: [], base: teardown.restore!, branch: teardown.branch ?? lane.branch, ...(teardown.into ? { into: teardown.into } : {}) };
        });
        return undefined;
      });
    }
    return Promise.resolve(undefined);
  }

  /** Returns the branch it kept because its work is not in `into` yet. `into` must be named: `branch -d` checks against whatever is checked out. */
  async release(project: Project, slotId: string | undefined, dropBranch?: string, into?: string): Promise<string | undefined> {
    if (!slotId) return undefined;
    const slot = loadLedger(project.state).slots[slotId];
    let kept: string | undefined;
    if (slot) {
      closeIndexes(this.ctx, project, slot);
      // A lane's copy left on a task's branch: that branch goes with the copy once the lane branch has all of it.
      const off = slot.lane && existsSync(slot.path) ? await currentBranch(slot.path) : undefined;
      if (existsSync(slot.path)) {
        await git(slot.path, ["switch", "--detach"]);
        await removeWorktree(project.root, slot.path);
        // And the directory the desk made: git leaves one often enough, and nothing else reliably sweeps it.
        this.discard(project, slot.path);
      }
      // A branch whose commits are not in `into` holds the only copy of that work: clutter is cheaper.
      if (dropBranch && !(into && (await dropMerged(project.root, dropBranch, into)))) kept = dropBranch;
      const laneBranch = slot.lane ? loadLedger(project.state).lanes[slot.lane]?.branch : undefined;
      if (off && laneBranch && off !== laneBranch && off !== dropBranch) await dropMerged(project.root, off, laneBranch);
      if (slot.workspaceId) {
        try {
          await this.workspaces.archive(slot.workspaceId);
        } catch (error) {
          this.ctx.log(project, `workspace ${slot.workspaceId} could not be put away: ${errorText(error)}`);
        }
      }
    }
    this.drop(project, slotId);
    this.ctx.event(project, { kind: "slot.released", slot: slotId, removed: Boolean(slot), kept });
    return kept;
  }

  private reserve(project: Project, holder: Holder): Slot {
    return this.ctx.transact(project, (ledger) => {
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
      const held = await pristineState(slot.path);
      if (held !== "clean") throw new Error(held === "dirty" ? `working copy ${slot.id} has uncommitted changes` : `git could not read working copy ${slot.id} at ${slot.path}`);
      const run = await git(slot.path, ["switch", "-c", branch, base]);
      if (run.code !== 0) throw new Error(run.stderr.trim() || "git switch failed");
      return true;
    }
    mkdirSync(dirname(slot.path), { recursive: true });
    const added = await addWorktree(project.root, slot.path, branch, base);
    if (!added.ok) throw new Error(added.message);
    return false;
  }

  /**
   * The copy's workspace, named after the project and then the work it holds now: the sweep knows the desk's copies by that
   * first word. A new one is filed under its project, since given a bare directory Paseo makes a project the plugin cannot remove.
   */
  private async workspaceFor(project: Project, slot: Slot, work: string): Promise<string> {
    const title = `${project.slug} ${slot.id} · ${work}`;
    if (slot.workspaceId) {
      await this.workspaces.retitle(slot.workspaceId, title).catch((error) => this.ctx.log(project, `workspace ${slot.workspaceId} kept its old name: ${errorText(error)}`));
      return slot.workspaceId;
    }
    const home = await this.projectWorkspace(project);
    if (!home.project) throw new Error(`the project's workspace in Paseo names no Paseo project, so its working copy was not made: Paseo would have made it a project of its own`);
    const { id: workspaceId } = await this.workspaces.make(title, slot.path, home.project);
    this.ctx.transact(project, (ledger) => {
      const entry = ledger.slots[slot.id];
      if (entry) entry.workspaceId = workspaceId;
    });
    return workspaceId;
  }

  /** What the desk opened and nothing holds any more. */
  sweep(project: Project, busy = false): Promise<void> {
    return sweepCopies(this.ctx, this.workspaces, project, busy);
  }

  /** Removes a path the desk made under its own worktree root, and the project's folder once empty. */
  private discard(project: Project, path: string): void {
    const root = join(worktreeRoot(), project.slug);
    if (!path.startsWith(`${root}/`)) return;
    try {
      rmSync(path, { recursive: true, force: true });
      if (readdirSync(root).length === 0) rmdirSync(root);
    } catch {}
  }

  private free(project: Project, slotId: string): void {
    return this.ctx.transact(project, (ledger) => {
      const entry = ledger.slots[slotId];
      if (entry) {
        delete entry.lane;
        delete entry.task;
      }
    });
  }

  private drop(project: Project, slotId: string): void {
    return this.ctx.transact(project, (ledger) => {
      delete ledger.slots[slotId];
    });
  }
}
