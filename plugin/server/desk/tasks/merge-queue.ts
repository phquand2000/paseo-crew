import { errorText } from "../../core/errors.ts";
import { mergeOf } from "../../core/git.ts";
import { KeyedQueue } from "../../core/keyed-queue.ts";
import { IN_QUEUE } from "../../domain/task.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import type { Project } from "../project.ts";
import { type MergeDesk, TaskMerge } from "./task-merge.ts";

/** One queue per lane: a lane's merges go one at a time, and a gate running on one holds no other lane's. */
export class MergeQueue {
  private readonly desk: MergeDesk;
  private readonly queues = new KeyedQueue();
  private readonly merge: TaskMerge;

  constructor(desk: MergeDesk, merged: (project: Project) => Promise<void>) {
    this.desk = desk;
    this.merge = new TaskMerge(desk, merged);
  }

  settled(project: Project): Promise<unknown> {
    return this.queues.idle(`${project.slug}\n`);
  }

  enqueue(project: Project, taskId: string): void {
    const lane = loadLedger(project.state).tasks[taskId]?.lane ?? "";
    void this.after(project, lane, () =>
      this.merge
        .run(project, taskId)
        .catch((error: unknown) => this.crashed(project, taskId, error))
        .catch((error: unknown) =>
          this.desk.log(project, `merge ${taskId} could not be marked failed: ${errorText(error)}`),
        ),
    );
  }

  /**
   * What a stop left accepted and unmerged goes through again, in the order it was accepted. Each lane's waits its turn in
   * that lane's queue, so a task it finds merging was cut off by the stop and is not one this run is merging.
   */
  async resume(project: Project): Promise<void> {
    const queued = Object.values(loadLedger(project.state).tasks).filter((task) => IN_QUEUE.includes(task.status));
    const lanes = new Set(queued.map((task) => task.lane));
    await Promise.all([...lanes].map((lane) => this.after(project, lane, () => this.takeUp(project, lane))));
  }

  /** What waits for a lane's copy to be clean goes through again: at a turn's end, when a writer there may have committed. */
  retry(project: Project): Promise<void> {
    const waiting = Object.values(loadLedger(project.state).tasks).some(
      (task) => task.status === "queued" && task.held,
    );
    return waiting ? this.resume(project) : Promise.resolve();
  }

  private after(project: Project, lane: string, run: () => Promise<void>): Promise<void> {
    return this.queues.run(`${project.slug}\n${lane}`, run);
  }

  /** A merge that threw fails, and its Lead is told; what stopped it goes to the project's log. */
  private async crashed(project: Project, taskId: string, error: unknown): Promise<void> {
    this.desk.log(project, `merge ${taskId} crashed: ${errorText(error)}`);
    const ledger = loadLedger(project.state);
    const task = ledger.tasks[taskId];
    const lane = task ? ledger.lanes[task.lane] : undefined;
    if (task && lane) await this.merge.fail(project, task, lane, `the merge stopped on an error: ${errorText(error)}.`);
    else this.desk.ledgers.moveTask(project, taskId, "fail");
  }

  private async takeUp(project: Project, laneId: string): Promise<void> {
    const ledger = loadLedger(project.state);
    const left = Object.values(ledger.tasks)
      .filter((task) => task.lane === laneId && IN_QUEUE.includes(task.status))
      .sort((a, b) => (a.acceptedAt ?? 0) - (b.acceptedAt ?? 0));
    for (const task of left) {
      const lane = ledger.lanes[task.lane];
      if (task.status === "merging" && lane && (await this.cutOff(project, task, lane))) continue;
      this.enqueue(project, task.id);
    }
  }

  /** A merge a stop cut off: finished if the lane branch had moved to it, else queued again; true when nothing is left. */
  private async cutOff(project: Project, task: Task, lane: Lane): Promise<boolean> {
    const cwd = lane.worktree;
    const made = cwd && task.branch ? await mergeOf(cwd, lane.branch, task.branch) : undefined;
    if (cwd && made) {
      await this.merge.landed(project, task, lane, cwd, made);
      return true;
    }
    this.desk.ledgers.moveTask(project, task.id, "requeue");
    return false;
  }
}
