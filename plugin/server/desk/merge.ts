import { commitsAhead, diffCounts, git, headSha, mergeBranch, mergeOf, pristineState, uncommittedIn } from "../core/git.ts";
import { fileKinds } from "../catalog/kit.ts";
import { type DeskContext } from "./context.ts";
import { errorText } from "../core/errors.ts";
import { IN_QUEUE, TASK } from "../domain/task.ts";
import { gateNote, taskGate } from "./gates.ts";
import { type Lane, type Task, loadLedger, othersLeft } from "./ledger.ts";
import type { Letter } from "./letters.ts";
import { mergeLetters } from "./merge-letters.ts";
import { holderOf } from "./holder.ts";
import { closeSeat } from "./incidents.ts";
import { type Project, serialIn } from "./project.ts";
import { reachNotes } from "./reach.ts";
import { bringLaneIn } from "./sync.ts";

type Outcome = "merged" | "conflict" | "red" | "fail";

/** A gate verdict on a task's branch, with the failing run's tail when this merge ran it. */
type Verdict = { ok: boolean; note: string; over?: string; run?: { tail: string; logFile: string } };

/** One queue per lane: a lane's merges go one at a time, each after the one before, and a gate running on one holds no other lane's. */
export class MergeQueue {
  private readonly ctx: DeskContext;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(ctx: DeskContext) {
    this.ctx = ctx;
  }

  settled(project: Project): Promise<unknown> {
    return Promise.all([...this.queues].filter(([key]) => key.startsWith(`${project.slug}\n`)).map(([, queue]) => queue));
  }

  enqueue(project: Project, taskId: string): void {
    void this.after(project, loadLedger(project.state).tasks[taskId]?.lane ?? "", () =>
      this.merge(project, taskId).catch(async (error) => {
        this.ctx.log(project, `merge ${taskId} crashed: ${errorText(error)}`);
        this.ctx.moveTask(project, taskId, "fail");
      }),
    );
  }

  /**
   * What a stop left accepted and unmerged goes through again, in the order it was accepted. Each lane's waits its turn in
   * that lane's queue, so a task it finds merging was cut off by the stop and is not one this run is merging.
   */
  async resume(project: Project): Promise<void> {
    const lanes = new Set(Object.values(loadLedger(project.state).tasks).filter((task) => IN_QUEUE.includes(task.status)).map((task) => task.lane));
    await Promise.all([...lanes].map((lane) => this.after(project, lane, () => this.takeUp(project, lane))));
  }

  /** What waits for a lane's copy to be clean goes through again: at a turn's end, when a writer there may have committed. */
  retry(project: Project): Promise<void> {
    const waiting = Object.values(loadLedger(project.state).tasks).some((task) => task.status === "queued" && task.held);
    return waiting ? this.resume(project) : Promise.resolve();
  }

  /** One merge at a time per lane, each after the one before whatever became of it. */
  private after(project: Project, lane: string, run: () => Promise<void>): Promise<void> {
    const key = `${project.slug}\n${lane}`;
    const next = (this.queues.get(key) ?? Promise.resolve()).then(run);
    this.queues.set(key, next.catch(() => undefined));
    return next;
  }

  private async takeUp(project: Project, laneId: string): Promise<void> {
    const ledger = loadLedger(project.state);
    const left = Object.values(ledger.tasks).filter((task) => task.lane === laneId && IN_QUEUE.includes(task.status)).sort((a, b) => (a.acceptedAt ?? 0) - (b.acceptedAt ?? 0));
    for (const task of left) {
      const lane = ledger.lanes[task.lane];
      if (task.status === "merging" && lane && (await this.cutOff(project, task, lane))) continue;
      this.enqueue(project, task.id);
    }
  }

  /** A merge a stop cut off: finished if git had made it, else undone and queued again; true when nothing is left to do. */
  private async cutOff(project: Project, task: Task, lane: Lane): Promise<boolean> {
    const cwd = lane.worktree;
    const made = cwd && task.branch ? await mergeOf(cwd, task.branch) : undefined;
    if (cwd && made) {
      await this.landed(project, task, lane, cwd, made);
      return true;
    }
    // Undone rather than finished: git stopped halfway leaves the copy dirty, and merging reads that as another writer there.
    if (cwd) await git(cwd, ["merge", "--abort"]);
    this.ctx.moveTask(project, task.id, "requeue");
    return false;
  }

  private async merge(project: Project, taskId: string): Promise<void> {
    const picked = this.ctx.transact(project, (ledger) => {
      const task = ledger.tasks[taskId];
      const lane = task ? ledger.lanes[task.lane] : undefined;
      if (!task || !lane || !TASK.move(task, "merge")) return undefined;
      return { task: { ...task }, lane: { ...lane } };
    });
    if (!picked) return;
    const { task, lane } = picked;
    const finish = (move: Outcome, letter: Letter) => this.finish(project, task, lane, move, letter);
    const cwd = lane.worktree;
    if (!cwd) return finish("fail", mergeLetters.mergeFailed(task, "the lane has no working copy", ""));
    const copy = await pristineState(cwd);
    if (copy === "dirty") return this.waitFor(project, task, lane, cwd);
    // A copy git could not read has no writer in it: it is already gone.
    if (copy === "unknown") {
      return finish("fail", mergeLetters.mergeFailed(task, `git could not read the lane's working copy at ${cwd}`, ""));
    }
    if (!task.branch || !task.worktree) return finish("fail", mergeLetters.mergeFailed(task, "the task's branch or copy is not on record", ""));
    if (!(await this.cleared(project, { ...task, branch: task.branch, worktree: task.worktree }, lane))) return;
    const ahead = await commitsAhead(cwd, "HEAD", task.branch);
    if (ahead === undefined) return finish("fail", mergeLetters.mergeFailed(task, `git could not count what ${task.branch} carries beyond the lane branch`, ""));
    // Nothing committed is a task that changed nothing, as in the lane's own copy: the Lead's accept stands.
    if (ahead === 0) {
      const head = await headSha(cwd);
      return head ? this.landed(project, task, lane, cwd, { before: head, after: head }) : finish("fail", mergeLetters.mergeFailed(task, `git could not read the lane branch in ${cwd}`, ""));
    }
    // It carries the lane's tip, so this merge conflicts only with a commit made in the lane's copy since it was gated.
    const merged = await mergeBranch(cwd, task.branch, `Merge ${task.id}: ${task.title}`);
    if (!merged.ok) {
      const why = merged.conflicts.length > 0 ? `the lane's copy took a commit while it was gated, which conflicts with it in ${merged.conflicts.join(", ")}; accepting it again brings that in first` : "git merge failed";
      return finish("fail", mergeLetters.mergeFailed(task, why, merged.message));
    }
    await this.landed(project, task, lane, cwd, merged);
  }

  /**
   * Whether the task may merge now: its lane brought into its own copy, and a green gate on that tree or its Lead's word over a
   * red one. What stops it is settled here: conflicts left for its Peer, a copy that cannot take the lane, a red gate.
   */
  private async cleared(project: Project, task: Task & { branch: string; worktree: string }, lane: Lane): Promise<boolean> {
    const synced = await bringLaneIn(task, lane);
    if ("conflicts" in synced) {
      await this.finish(project, task, lane, "conflict", mergeLetters.conflict(task, synced.conflicts, lane.branch, "left", synced.by));
      return false;
    }
    if ("not" in synced) {
      await this.hold(project, task, lane, `its own copy cannot take ${lane.branch} in: ${synced.not}`);
      return false;
    }
    const verdict = await this.verdict(project, task);
    if (verdict?.ok === false && verdict.over === undefined) {
      await this.finish(project, task, lane, "red", mergeLetters.red(task, lane.branch, verdict.note, verdict.run));
      return false;
    }
    if (verdict?.over !== undefined) this.ctx.event(project, { kind: "gate.overridden", lane: lane.id, by: lane.lead ?? "", task: task.id, reason: verdict.over });
    return true;
  }

  /** The gate's verdict on the task's head: its hand-back's when that ran on the same commit, else one run now and kept on the task. */
  private async verdict(project: Project, task: Task & { worktree: string }): Promise<Verdict | undefined> {
    const head = await headSha(task.worktree);
    const last = task.handback?.gate;
    if (last && last.sha === head) return last;
    const run = await taskGate(project, task.id, task.worktree);
    if (!run) return undefined;
    this.ctx.setTask(project, task.id, (entry) => {
      if (entry.handback) entry.handback.gate = { ok: run.ok, note: run.note, sha: head };
    });
    return { ok: run.ok, note: run.note, run: { tail: run.tail, logFile: run.logFile } };
  }

  /** The lane's copy holds another writer's work: the Lead's accept stands, the task waits queued, and its Lead is told once for each reason. */
  private async waitFor(project: Project, task: Task, lane: Lane, cwd: string): Promise<void> {
    const holder = holderOf(loadLedger(project.state), lane);
    await this.hold(project, task, lane, `the lane's working copy has uncommitted changes (${await uncommittedIn(cwd)})${holder ? `, and ${holder.id} holds it` : ""}`, holder?.id);
  }

  /** The task waits queued for `why` to clear, tried again as each turn ends; its Lead is told once for each reason. */
  private async hold(project: Project, task: Task, lane: Lane, why: string, holder?: string): Promise<void> {
    let told = false;
    this.ctx.moveTask(project, task.id, "requeue", (entry) => {
      told = entry.held?.why === why;
      entry.held = { why };
    });
    if (!told) await this.ctx.post(lane.lead, mergeLetters.waits(task, why, holder));
  }

  /** A merge git made, recorded and told with what it changed. */
  private async landed(project: Project, task: Task, lane: Lane, cwd: string, merged: { before: string; after: string }): Promise<void> {
    const counts = await diffCounts(cwd, merged.before, merged.after, fileKinds(this.ctx.kit));
    const serial = await serialIn(this.ctx.kit, project, cwd);
    this.ctx.setTask(project, task.id, (entry) => {
      entry.mergeSha = merged.after;
    });
    const now = loadLedger(project.state);
    // The gate ran before the merge, on the tree it made; the verdict on record, or its Lead's word over it, is what it says.
    const gate = gateNote(project, now.tasks[task.id] ?? task);
    await this.finish(project, task, lane, "merged", mergeLetters.merged(task, counts, reachNotes(now, task, lane, counts?.files ?? [], serial), gate, othersLeft(now, task).length === 0));
  }

  /** The record follows what the merge did, and its Lead is told. */
  private async finish(project: Project, task: Task, lane: Lane, move: Outcome, letter: Letter): Promise<void> {
    const moved = this.ctx.moveTask(project, task.id, move, (entry) => delete entry.held);
    if (typeof moved !== "object") return;
    await this.ctx.post(lane.lead, letter);
    this.ctx.event(project, { kind: `merge.${moved.status}`, task: task.id });
    // Its task is settled, so what the watch told about it is too; its Peer stays with its copy until its Lead releases it.
    if (moved.status === "merged" && task.peer) this.ctx.incidents(project, (incidents) => closeSeat(incidents, task.peer!, Date.now()));
  }
}
