import {
  branchExists,
  cleanState,
  currentBranch,
  dropMerged,
  git,
  mergeUnderWay,
  pristineState,
} from "../../core/git.ts";
import type { DeskBase } from "../base.ts";
import { openIndexes } from "./indexes.ts";
import type { Project } from "../project/project.ts";
import type { Slots } from "./slots.ts";
import { recordEvent } from "../store/event-log.ts";

/** The project's own checkout as a lane's copy: taken over on a new branch or the one it is on, and put back on base. */
export class OwnCopy {
  private readonly desk: Pick<DeskBase, "log" | "indexesFor">;
  private readonly slots: Pick<Slots, "projectWorkspace">;

  constructor(desk: Pick<DeskBase, "log" | "indexesFor">, slots: Pick<Slots, "projectWorkspace">) {
    this.desk = desk;
    this.slots = slots;
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
    const run = await git(project.root, ["switch", "--no-track", "-c", branch, base]);
    if (run.code !== 0) throw new Error(run.stderr.trim() || "git switch failed");
    try {
      const taken = await this.takeOwnCopy(project);
      recordEvent(project, { kind: "lane.inPlace", branch, base });
      return taken;
    } catch (error) {
      await this.giveBack(project, base, branch);
      throw error;
    }
  }

  /** Carries on the branch the project's own copy is on, or first starts `branch` from `from` there with the uncommitted work along. */
  async carryOn(project: Project, branch: string, from?: string): Promise<{ path: string; workspaceId: string }> {
    if (from) {
      const run = await git(project.root, ["switch", "--no-track", "-c", branch]);
      if (run.code !== 0) throw new Error(run.stderr.trim() || "git switch failed");
    }
    try {
      const taken = await this.takeOwnCopy(project);
      recordEvent(project, { kind: "lane.onBranch", branch, ...(from ? { from } : {}) });
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
      this.desk.log(
        project,
        `the project's own copy could not go back from ${branch} to ${from}: ${run.stderr.trim() || `git switch exited ${run.code}`}`,
      );
      return;
    }
    await dropMerged(project.root, branch, from);
    recordEvent(project, { kind: "lane.unstarted", branch, from });
  }

  private async takeOwnCopy(project: Project): Promise<{ path: string; workspaceId: string }> {
    const workspaceId = (await this.slots.projectWorkspace(project)).id;
    openIndexes(this.desk, project, { id: "main", path: project.root }, true);
    return { path: project.root, workspaceId };
  }

  /** Undoes what `inPlace` did to the owner's repository: a lane failing mid-open has no slot id for `openLane` to clean up through. */
  async giveBack(project: Project, base: string, branch: string): Promise<void> {
    if (!(await this.restore(project, base, branch))) return;
    // Nothing committed on it: the branch is the desk's litter, and `release` keeps the other case for the Human.
    await dropMerged(project.root, branch, base);
    recordEvent(project, { kind: "lane.gaveBack", branch, base });
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
      this.desk.log(
        project,
        `the project's own working copy is still on ${left ?? "a lane branch"} and not back on ${base}: ${why}`,
      );
      recordEvent(project, { kind: "restore.held", base, branch: left ?? null, why: copy });
      return false;
    }
    const run = await git(project.root, ["switch", base]);
    if (run.code !== 0) {
      this.desk.log(
        project,
        `the project's own working copy could not go back to ${base}: ${run.stderr.trim() || `git switch exited ${run.code}`}`,
      );
      recordEvent(project, { kind: "restore.held", base, branch: left ?? null, why: "switch-failed" });
      return false;
    }
    return true;
  }
}
