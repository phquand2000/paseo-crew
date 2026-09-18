import { commitsAhead, diffCounts, mergeBranch, outsideOwned, pristineState } from "../core/git.ts";
import type { Agents } from "./agents.ts";
import { type DeskContext, errorText } from "./context.ts";
import { gateNote } from "./gates.ts";
import type { TaskStatus } from "./ledger.ts";
import { letters } from "./letters.ts";
import type { Project } from "./project.ts";

export class MergeQueue {
  private readonly ctx: DeskContext;
  private readonly agents: Agents;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(ctx: DeskContext, agents: Agents) {
    this.ctx = ctx;
    this.agents = agents;
  }

  settled(project: Project): Promise<unknown> {
    return this.queues.get(project.slug) ?? Promise.resolve();
  }

  enqueue(project: Project, taskId: string): void {
    const previous = this.queues.get(project.slug) ?? Promise.resolve();
    const run = previous
      .then(() => this.merge(project, taskId))
      .catch((error) => {
        this.ctx.log(project, `merge ${taskId} crashed: ${errorText(error)}`);
        return this.ctx.setTask(project, taskId, (task) => {
          task.status = "failed";
        });
      });
    this.queues.set(project.slug, run);
  }

  private async merge(project: Project, taskId: string): Promise<void> {
    const picked = await this.ctx.ledger(project, (ledger) => {
      const task = ledger.tasks[taskId];
      const lane = task ? ledger.lanes[task.lane] : undefined;
      if (!task || !lane || task.status !== "queued") return undefined;
      task.status = "merging";
      return { task: { ...task }, lane: { ...lane } };
    });
    if (!picked) return;
    const { task, lane } = picked;
    const finish = async (status: TaskStatus, text: string) => {
      await this.ctx.setTask(project, taskId, (entry) => {
        entry.status = status;
      });
      await this.ctx.post(lane.lead, `merge:${taskId}:${status}:${Date.now()}`, text);
      this.ctx.event(project, { kind: `merge.${status}`, task: taskId });
    };
    const cwd = lane.worktree;
    if (!cwd) return finish("failed", letters.mergeFailed(task, "the lane has no working copy", ""));
    const copy = await pristineState(cwd);
    if (copy === "dirty") {
      return finish("done", letters.mergeFailed(task, "the lane's working copy has uncommitted changes from its current writer; accept again after that task hands back", ""));
    }
    // A copy git could not read is not a copy with a writer in it. Told otherwise, the Lead went
    // looking for uncommitted work in a directory that had already been taken away.
    if (copy === "unknown") {
      return finish("failed", letters.mergeFailed(task, `git could not read the lane's working copy at ${cwd}`, ""));
    }
    if (!task.branch) return finish("failed", letters.mergeFailed(task, "the task branch is not on record", ""));
    const ahead = await commitsAhead(cwd, "HEAD", task.branch);
    if (ahead === undefined) return finish("failed", letters.mergeFailed(task, `git could not count what ${task.branch} carries beyond the lane branch`, ""));
    if (ahead === 0) return finish("failed", letters.mergeFailed(task, `${task.branch} has no commits beyond the lane branch`, ""));
    const merged = await mergeBranch(cwd, task.branch, `Merge ${task.id}: ${task.title}`);
    if (!merged.ok) {
      return merged.conflicts.length > 0
        ? finish("rework", letters.conflict(task, merged.conflicts, lane.branch))
        : finish("failed", letters.mergeFailed(task, "git merge failed", merged.message));
    }
    const counts = await diffCounts(cwd, merged.before, merged.after);
    // No gate here. Where the owner gates each task the Lead had the verdict with the hand-back and
    // accepted with it in hand; running it again and undoing the merge on red took back a decision
    // that was the Lead's — the "evidence, not a veto" the Lead's own prompt promises.
    const gate = gateNote(project, task);
    await this.ctx.setTask(project, taskId, (entry) => {
      entry.mergeSha = merged.after;
    });
    await finish("merged", letters.merged(task, counts, outsideOwned(counts?.files ?? [], task.owned), gate));
    await this.agents.retire(project, task, lane.branch);
  }
}
