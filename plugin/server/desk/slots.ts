import { existsSync, mkdirSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { addWorktree, branchExists, cleanState, contains, currentBranch, excludeFromGit, git, pristineState, removeWorktree } from "../core/git.ts";
import type { Workspaces } from "../core/ports.ts";
import { worktreeRoot } from "../core/paths.ts";
import type { DeskContext } from "./context.ts";
import { type Ledger, type Slot, loadLedger, nextSlotId } from "./ledger.ts";
import { clip } from "./letters.ts";
import type { Project } from "./project.ts";

export type Holder = { lane?: string; task?: string };

/** What putting a lane's copy away means: the copy itself if it had one, the project's branch if not. */
export type Teardown = { project: Project; slot?: string; dropBranch?: string; into?: string; restore?: string; lane?: string; branch?: string };

export class Slots {
  private readonly ctx: DeskContext;
  private readonly workspaces: Workspaces;


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
    const copy = await pristineState(project.root);
    if (copy !== "clean") {
      throw new Error(
        copy === "dirty"
          ? "the project's own working copy has uncommitted changes, so a lane cannot take it over; commit or stash them, or open the lane with isolate true"
          : `git could not read the project's own working copy at ${project.root}, so a lane cannot take it over`,
      );
    }
    if (await branchExists(project.root, branch)) throw new Error(`the branch ${branch} already exists`);
    const run = await git(project.root, ["switch", "-c", branch, base]);
    if (run.code !== 0) throw new Error(run.stderr.trim() || "git switch failed");
    try {
      const workspaceId = await this.projectWorkspace(project);
      this.index(project, { id: "main", path: project.root, createdAt: Date.now() }, true);
      this.ctx.event(project, { kind: "lane.inPlace", branch, base });
      return { path: project.root, workspaceId };
    } catch (error) {
      await this.giveBack(project, base, branch);
      throw error;
    }
  }

  /**
   * Undoes what `inPlace` did to the owner's own repository.
   *
   * `inPlace` switches that copy onto the lane's branch, and it had no inverse any caller could
   * reach: `openLane` cleans up through a slot id, which an in-place lane does not have, so a lane
   * that failed after taking the copy — a role that cannot lead, a Lead that would not start — left
   * the owner's repository checked out on a branch belonging to a lane that had just been closed.
   * `restore` is reachable only from a teardown, and `close_lane` refuses a lane that is closed
   * already, so there was no way back that did not involve git by hand.
   */
  async giveBack(project: Project, base: string, branch: string): Promise<void> {
    if (!(await this.restore(project, base, branch))) return;
    // Nothing was committed on it, or the lane never got far enough to commit: the branch is the
    // desk's own litter then, not a Peer's work, and `release` keeps the other case for the Human.
    if ((await contains(project.root, base, branch)) === true) await git(project.root, ["branch", "-D", branch]);
    this.ctx.event(project, { kind: "lane.gaveBack", branch, base });
  }

  async projectWorkspace(project: Project): Promise<string> {
    const kept = await this.workspaces.named(project.slug).catch(() => undefined);
    return kept ?? (await this.workspaces.make(project.slug, project.root));
  }

  /**
   * Puts the project's own copy back on base, and says whether it is there.
   *
   * `left` is the branch this wait was for: a copy some later lane now owns is not this one's to move,
   * and that counts as done. Everything else that stops the switch is written down. It used to return
   * on a falsy read and a non-zero exit alike, with no event and no line in the log, after its caller
   * had already deleted the record that remembered the copy was parked — so the project sat on a lane
   * branch that no longer existed and nothing anywhere said so. An untracked file is not a reason:
   * git switches over those, and a gate log or a coverage directory left by a seat was enough.
   */
  async restore(project: Project, base: string, left?: string): Promise<boolean> {
    if (left && (await currentBranch(project.root)) !== left) return true;
    const copy = await cleanState(project.root);
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

  /**
   * Puts a lane's working copy away, or waits for the seats still writing in it to stop.
   *
   * A seat whose archive was deferred to the end of its turn is still writing: removing its copy
   * --force takes the work it has not committed, dropping the branch takes the work it has, and
   * switching the project's own copy back to base lets its next commit land on base. So the
   * teardown waits with it, and runs when the last writer there stops.
   */
  async putAway(teardown: Teardown, writers: string[] = []): Promise<string | undefined> {
    const waiting = [...new Set(writers)];
    if (waiting.length === 0 || (!teardown.slot && !teardown.restore)) return this.run(teardown);
    if (teardown.slot) {
      await this.ctx.ledger(teardown.project, (ledger) => {
        const slot = ledger.slots[teardown.slot!];
        if (slot) slot.releasing = { writers: waiting, dropBranch: teardown.dropBranch, into: teardown.into };
      });
    } else if (teardown.lane) {
      await this.ctx.ledger(teardown.project, (ledger) => {
        const lane = ledger.lanes[teardown.lane!];
        if (lane) lane.restoring = { writers: waiting, base: teardown.restore!, branch: teardown.branch ?? lane.branch };
      });
    }
    this.ctx.event(teardown.project, { kind: "slot.heldOpen", slot: teardown.slot ?? "in place", writers: waiting });
    return undefined;
  }

  /** Finishes what a seat's own turn was holding up, once nothing else is writing in that copy. */
  async stopped(agentId: string): Promise<void> {
    for (const project of this.ctx.projects.values()) {
      await this.finish(project, (id) => id === agentId);
    }
  }

  /**
   * A writer that is not a seat any more has stopped for good.
   *
   * The end of a turn is the ordinary way a teardown finishes, and it does not always come: a seat
   * can be archived by its owner, crash, or be left behind by a daemon restart that took the
   * in-memory half of this with it. Without this the copy, its workspace and its branch would sit
   * there for good, and the sweep will not touch a copy the ledger still lists.
   */
  reap(project: Project, live: Set<string>): Promise<void> {
    return this.finish(project, (id) => !live.has(id));
  }

  private async finish(project: Project, stopped: (agentId: string) => boolean): Promise<void> {
    for (const lane of Object.values(loadLedger(project.state).lanes)) {
      if (!lane.restoring) continue;
      const waiting = lane.restoring.writers;
      const left = waiting.filter((id) => !stopped(id));
      // A record with nobody left to wait for is a restore that did not happen, retried each time.
      if (waiting.length > 0 && left.length === waiting.length) continue;
      if (left.length > 0) {
        await this.ctx.ledger(project, (ledger) => {
          const entry = ledger.lanes[lane.id];
          if (entry?.restoring) entry.restoring.writers = left;
        });
        continue;
      }
      // The record is what remembers that the project's own copy is parked on a lane branch, so it
      // goes only once the copy is really back. Deleted first, a switch that could not happen took
      // the only token a later round could have retried from with it.
      if (!(await this.restore(project, lane.restoring!.base, lane.restoring!.branch))) continue;
      await this.ctx.ledger(project, (ledger) => {
        const entry = ledger.lanes[lane.id];
        if (entry) delete entry.restoring;
      });
    }
    for (const slot of Object.values(loadLedger(project.state).slots)) {
      const waiting = slot.releasing?.writers ?? [];
      const left = waiting.filter((id) => !stopped(id));
      if (waiting.length === 0 || left.length === waiting.length) continue;
      if (left.length > 0) {
        await this.ctx.ledger(project, (ledger) => {
          const entry = ledger.slots[slot.id];
          if (entry?.releasing) entry.releasing.writers = left;
        });
        continue;
      }
      await this.release(project, slot.id, slot.releasing?.dropBranch, slot.releasing?.into);
    }
  }

  private run(teardown: Teardown): Promise<string | undefined> {
    if (teardown.slot) return this.release(teardown.project, teardown.slot, teardown.dropBranch, teardown.into);
    if (teardown.restore) {
      // Recorded when it does not happen, as a wait for nobody, so the round retries it and Detach
      // sees it: with no writers to wait for, a copy that would not switch left no trace in the ledger.
      return this.restore(teardown.project, teardown.restore, teardown.branch).then(async (back) => {
        if (back || !teardown.lane) return undefined;
        await this.ctx.ledger(teardown.project, (ledger) => {
          const lane = ledger.lanes[teardown.lane!];
          if (lane) lane.restoring = { writers: [], base: teardown.restore!, branch: teardown.branch ?? lane.branch };
        });
        return undefined;
      });
    }
    return Promise.resolve(undefined);
  }

  /**
   * Returns the branch it was asked to drop and kept, because the work on it is not in `into` yet.
   *
   * `into` is the branch the work was supposed to land in, and it has to be named: `branch -d` reads
   * whatever is checked out where it runs, which for a lane in a copy of its own is the base branch
   * — so a task merged into its lane would look unmerged and every landed branch would pile up.
   */
  async release(project: Project, slotId: string | undefined, dropBranch?: string, into?: string): Promise<string | undefined> {
    if (!slotId) return undefined;
    const slot = loadLedger(project.state).slots[slotId];
    let kept: string | undefined;
    if (slot) {
      if (existsSync(slot.path)) {
        await git(slot.path, ["switch", "--detach"]);
        await removeWorktree(project.root, slot.path);
        // And the directory the desk made for it. git leaves one behind often enough — a file it did
        // not track, a removal it half did — and the only thing that swept it was a patrol round for
        // a project the desk still remembers, which is not a promise. Four of these were sitting in
        // the owner's worktree root, from projects that no longer had any state at all.
        this.discard(project, slot.path);
      }
      // A branch whose commits are not in `into` holds work nothing else has, and for a cut task
      // those commits are all the Peer leaves behind. Clutter is cheaper than deleting them.
      if (dropBranch) {
        const landed = into ? (await contains(project.root, into, dropBranch)) === true : false;
        if (landed) await git(project.root, ["branch", "-D", dropBranch]);
        else kept = dropBranch;
      }
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

  private async createWorkspace(project: Project, slot: Slot): Promise<string> {
    const workspaceId = await this.workspaces.make(`${project.slug} ${slot.id}`, slot.path);
    await this.ctx.ledger(project, (ledger) => {
      const entry = ledger.slots[slot.id];
      if (entry) entry.workspaceId = workspaceId;
    });
    return workspaceId;
  }

  /**
   * What the desk opened and nothing holds any more.
   *
   * Liveness is read under the ledger lock at the moment it is used, not from a snapshot taken
   * before. `reserve` writes a new slot row under that same lock and only then does `git worktree
   * add`, and a sweep waits on a run of daemon round-trips in between — so a copy that was created
   * while this method was waiting could not be in a list read before it started, and was removed with
   * `--force` out from under the lane that was still opening.
   */
  async sweep(project: Project, busy = false): Promise<void> {
    const heldIds = (ledger: Ledger): Set<string> => {
      const held = new Set<string>();
      for (const slot of Object.values(ledger.slots)) if (slot.workspaceId) held.add(slot.workspaceId);
      for (const lane of Object.values(ledger.lanes)) if (lane.status === "open" && lane.workspaceId) held.add(lane.workspaceId);
      return held;
    };
    for (const workspace of await this.workspaces.owned(project.slug)) {
      if (busy && workspace.name === project.slug) continue;
      if (await this.ctx.read(project, (current) => heldIds(current).has(workspace.id))) continue;
      try {
        await this.workspaces.archive(workspace.id);
        this.ctx.event(project, { kind: "workspace.swept", workspace: workspace.id, name: workspace.name });
      } catch (error) {
        this.ctx.log(project, `workspace ${workspace.name} could not be swept: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const root = join(worktreeRoot(), project.slug);
    if (!root.startsWith(worktreeRoot()) || !existsSync(root)) return;
    // Read and listed together inside the lock, so nothing can reserve a slot between the two. The
    // removal itself spans several awaits outside it; what keeps a new copy from being caught there is
    // that a slot id is never handed out twice, so a stray's path is never a path `reserve` gives out.
    const live = (current: Ledger) => new Set(Object.values(current.slots).map((slot) => slot.path));
    const strays = await this.ctx.read(project, (current) => {
      const held = live(current);
      return readdirSync(root)
        .map((name) => join(root, name))
        .filter((path) => !held.has(path));
    });
    for (const path of strays) {
      // And asked once more just before, for a row a reserve may have written for a path from before
      // ids stopped being reused.
      if (await this.ctx.read(project, (current) => live(current).has(path))) continue;
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

  /** Removes a path the desk made under its own worktree root, and the project's folder once empty. */
  private discard(project: Project, path: string): void {
    const root = join(worktreeRoot(), project.slug);
    if (!path.startsWith(`${root}/`)) return;
    try {
      rmSync(path, { recursive: true, force: true });
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
