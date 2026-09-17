import { join } from "node:path";
import { runGate } from "../core/gate.ts";
import { commitsAhead, diffCounts, isPristine, mergeBranch, outsideOwned, resetHard } from "../core/git.ts";
import type { Agents } from "./agents.ts";
import { type DeskContext, errorText } from "./context.ts";
import { gateNote } from "./gates.ts";
import type { TaskStatus } from "./ledger.ts";
import { letters } from "./letters.ts";
import { type Project, loadConfig } from "./project.ts";

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
    if (!(await isPristine(cwd))) {
      return finish("done", letters.mergeFailed(task, "the lane's working copy has uncommitted changes from its current writer; accept again after that task hands back", ""));
    }
    if (!task.branch || (await commitsAhead(cwd, "HEAD", task.branch)) === 0) {
      return finish("failed", letters.mergeFailed(task, `${task.branch ?? "the task branch"} has no commits beyond the lane branch`, ""));
    }
    const merged = await mergeBranch(cwd, task.branch, `Merge ${task.id}: ${task.title}`);
    if (!merged.ok) {
      return merged.conflicts.length > 0
        ? finish("rework", letters.conflict(task, merged.conflicts, lane.branch))
        : finish("failed", letters.mergeFailed(task, "git merge failed", merged.message));
    }
    const counts = await diffCounts(cwd, merged.before, merged.after);
    const config = loadConfig(project.state);
    let gate = gateNote(project);
    if (config.gate && config.gateOn === "task") {
      const logFile = join(project.state, "gates", `${taskId}-${Date.now()}.log`);
      const result = await runGate(config.gate, cwd, logFile, config.gateTimeoutMinutes * 60_000);
      if (!result.ok) {
        await resetHard(cwd, merged.before);
        const reason = result.timedOut ? `the gate timed out after ${config.gateTimeoutMinutes} minutes` : `the gate failed with exit ${result.code}`;
        return finish("failed", letters.mergeFailed(task, reason, result.tail, logFile));
      }
      gate = `${config.gate} passed in ${result.seconds}s`;
    }
    await finish("merged", letters.merged(task, counts, outsideOwned(counts.files, task.owned), gate));
    await this.agents.retire(project, task, true);
  }
}
