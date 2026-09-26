import { recordEvent } from "./store/event-log.ts";
import { KeyedQueue } from "../core/keyed-queue.ts";
import { changedFiles, commitsAhead, currentBranch, diffCounts, headSha, mergeOf, uncommittedIn } from "../core/git.ts";
import { advance, mergeCommit } from "../core/land.ts";
import { fileKinds } from "../catalog/kit.ts";
import type { DeskBase } from "./base.ts";
import { errorText } from "../core/errors.ts";
import { IN_QUEUE, TASK } from "../domain/task.ts";
import { gateNote, taskGate } from "./gates.ts";
import { type Lane, type Task, loadLedger, othersLeft } from "./ledger.ts";
import type { Letter } from "./letters.ts";
import { mergeLetters } from "./merge-letters.ts";
import { closeSeat } from "./incidents.ts";
import { type Project, serialIn } from "./project.ts";
import { reachNotes } from "./reach.ts";
import { backOnLane, bringLaneIn } from "./sync.ts";

type Outcome = "merged" | "conflict" | "red" | "fail";

/** A gate verdict on a task's branch, with the failing run's tail when this merge ran it. */
type Verdict = { ok: boolean; note: string; over?: string; run?: { tail: string; logFile: string } };

/** One queue per lane: a lane's merges go one at a time, each after the one before, and a gate running on one holds no other lane's. */
export class MergeQueue {
  private readonly desk: Pick<DeskBase, "kit" | "ledgers" | "incidents" | "mail" | "log">;
  private readonly queues = new KeyedQueue();
  /** What a merge lets go on: the tasks that waited for it start. */
  private readonly merged: (project: Project) => Promise<void>;

  constructor(desk: Pick<DeskBase, "kit" | "ledgers" | "incidents" | "mail" | "log">, merged: (project: Project) => Promise<void>) {
    this.desk = desk;
    this.merged = merged;
  }

  settled(project: Project): Promise<unknown> {
    return this.queues.idle(`${project.slug}\n`);
  }

  enqueue(project: Project, taskId: string): void {
    void this.after(project, loadLedger(project.state).tasks[taskId]?.lane ?? "", () =>
      this.merge(project, taskId).catch(async (error) => {
        this.desk.log(project, `merge ${taskId} crashed: ${errorText(error)}`);
        const ledger = loadLedger(project.state);
        const task = ledger.tasks[taskId];
        const lane = task ? ledger.lanes[task.lane] : undefined;
        if (task && lane) await this.finish(project, task, lane, "fail", mergeLetters.mergeFailed(task, `the merge stopped on an error: ${errorText(error)}.`, ""));
        else this.desk.ledgers.moveTask(project, taskId, "fail");
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

  private after(project: Project, lane: string, run: () => Promise<void>): Promise<void> {
    return this.queues.run(`${project.slug}\n${lane}`, run);
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

  /** A merge a stop cut off: finished if the lane branch had moved to it, else queued again; true when nothing is left to do. */
  private async cutOff(project: Project, task: Task, lane: Lane): Promise<boolean> {
    const cwd = lane.worktree;
    const made = cwd && task.branch ? await mergeOf(cwd, lane.branch, task.branch) : undefined;
    if (cwd && made) {
      await this.landed(project, task, lane, cwd, made);
      return true;
    }
    this.desk.ledgers.moveTask(project, task.id, "requeue");
    return false;
  }

  private async merge(project: Project, taskId: string): Promise<void> {
    const picked = this.desk.ledgers.transact(project, (ledger) => {
      const task = ledger.tasks[taskId];
      const lane = task ? ledger.lanes[task.lane] : undefined;
      if (!task || !lane) return undefined;
      // Nothing lands in a lane on hold, its own branch included: accepted, it waits queued, and resume_lane tries it again.
      if (lane.onHold) {
        if (task.status === "queued") task.held = { why: "its lane is on hold" };
        return undefined;
      }
      if (!TASK.move(task, "merge")) return undefined;
      return { task: { ...task }, lane: { ...lane } };
    });
    if (!picked) return;
    const { task, lane } = picked;
    const finish = (move: Outcome, letter: Letter) => this.finish(project, task, lane, move, letter);
    const cwd = lane.worktree;
    if (!cwd) return finish("fail", mergeLetters.mergeFailed(task, "the lane has no working copy", ""));
    if (!task.branch || !task.worktree) return finish("fail", mergeLetters.mergeFailed(task, "the task's branch or copy is not on record", ""));
    const at = await this.cleared(project, { ...task, branch: task.branch, worktree: task.worktree }, lane);
    if (!at) return;
    const ahead = await commitsAhead(cwd, at, task.branch);
    if (ahead === undefined) return finish("fail", mergeLetters.mergeFailed(task, `git could not count what ${task.branch} carries beyond the lane branch`, ""));
    // Nothing committed beyond the lane is a task that changed nothing: the Lead's accept stands.
    if (ahead === 0) return this.landed(project, task, lane, cwd, { before: at, after: at });
    // Its branch carries the lane's tip it was gated with, so the lane takes that very tree, moved only from that tip.
    const made = await mergeCommit(cwd, at, task.branch, `Merge ${task.id}: ${task.title}`);
    if (!made) return finish("fail", mergeLetters.mergeFailed(task, "git could not make the merge commit", ""));
    const stopped = await advance(cwd, lane.branch, at, made);
    if (stopped?.why === "moved") return this.hold(project, task, lane, `${lane.branch} moved while it was gated, so it goes round again with that brought in`, false);
    if (stopped?.why === "dirty") return this.waitFor(project, task, lane, cwd);
    if (stopped) return finish("fail", mergeLetters.mergeFailed(task, stopped.why === "elsewhere" ? `${lane.branch} is checked out in another working copy` : (stopped.detail ?? `git could not read the lane's working copy at ${cwd}`), ""));
    await this.landed(project, task, lane, cwd, { before: at, after: made });
  }

  /**
   * The lane tip the task may merge onto now: its lane brought into its own copy, and a green gate on that tree or its Lead's
   * word over a red one. What stops it is settled here: conflicts left for its Peer, a copy that cannot take the lane, a red gate.
   */
  private async cleared(project: Project, task: Task & { branch: string; worktree: string }, lane: Lane): Promise<string | undefined> {
    const synced = await bringLaneIn(task, lane);
    if ("conflicts" in synced) {
      await this.finish(project, task, lane, "conflict", mergeLetters.conflict(task, synced.conflicts, lane.branch, "left", synced.by));
      return undefined;
    }
    if ("not" in synced) {
      await this.hold(project, task, lane, `its own copy cannot take ${lane.branch} in: ${synced.not}`);
      return undefined;
    }
    const verdict = await this.verdict(project, task, lane);
    if (verdict?.ok === false && verdict.over === undefined) {
      await this.finish(project, task, lane, "red", mergeLetters.red(task, lane.branch, verdict.note, verdict.run));
      return undefined;
    }
    if (verdict?.over !== undefined) recordEvent(project, { kind: "gate.overridden", lane: lane.id, by: lane.lead ?? "", task: task.id, reason: verdict.over });
    return synced.at;
  }

  /** The gate's verdict on the task's head: its hand-back's when that ran on the same commit, else one run now and kept on the task. */
  private async verdict(project: Project, task: Task & { worktree: string }, lane: Lane): Promise<Verdict | undefined> {
    const head = await headSha(task.worktree);
    const last = task.handback?.gate;
    if (last && last.sha === head) return last;
    const run = await taskGate(this.desk.kit, project, task.id, task.worktree, await changedFiles(task.worktree, `${lane.branch}...HEAD`));
    if (!run) return undefined;
    this.desk.ledgers.setTask(project, task.id, (entry) => {
      if (entry.handback) entry.handback.gate = { ok: run.ok, note: run.note, sha: head };
    });
    return { ok: run.ok, note: run.note, run: { tail: run.tail, logFile: run.logFile } };
  }

  /** The lane branch is checked out in the lane's copy, and work is left there: the merge would move files under it. */
  private async waitFor(project: Project, task: Task, lane: Lane, cwd: string): Promise<void> {
    await this.hold(project, task, lane, `the lane's working copy has uncommitted changes (${await uncommittedIn(cwd)})`);
  }

  /**
   * The Lead's accept stands, the task waits queued for `why` to clear, and it is tried again as each turn ends; its Lead is told
   * once for each reason, woken only when `why` is something to clear.
   */
  private async hold(project: Project, task: Task, lane: Lane, why: string, clears = true): Promise<void> {
    let told = false;
    this.desk.ledgers.moveTask(project, task.id, "requeue", (entry) => {
      told = entry.held?.why === why;
      entry.held = { why };
    });
    if (!told) await this.desk.mail.post(lane.lead, mergeLetters.waits(task, why, clears));
  }

  /** A merge git made, recorded and told with what it changed. */
  private async landed(project: Project, task: Task, lane: Lane, cwd: string, merged: { before: string; after: string }): Promise<void> {
    const counts = await diffCounts(cwd, merged.before, merged.after, fileKinds(this.desk.kit));
    const serial = await serialIn(this.desk.kit, project, cwd);
    this.desk.ledgers.setTask(project, task.id, (entry) => {
      entry.mergeSha = merged.after;
    });
    // The lane branch moved: what its Lead reported ready is not what it holds now.
    if (merged.after !== merged.before) {
      this.desk.ledgers.transact(project, (ledger) => {
        delete ledger.lanes[lane.id]?.ready;
      });
    }
    // A task in the lane's copy gives it back to the lane branch: the same tree, so nothing in it changes.
    if (task.mode !== "parallel" && (await currentBranch(cwd)) === task.branch) await backOnLane(lane);
    const now = loadLedger(project.state);
    // The gate ran before the merge, on the tree it made; the verdict on record, or its Lead's word over it, is what it says.
    const gate = gateNote(project, now.tasks[task.id] ?? task);
    await this.finish(project, task, lane, "merged", mergeLetters.merged(task, counts, reachNotes(now, task, lane, counts?.files ?? [], serial), gate, othersLeft(now, task).length === 0));
  }

  /** The record follows what the merge did, and its Lead is told. */
  private async finish(project: Project, task: Task, lane: Lane, move: Outcome, letter: Letter): Promise<void> {
    const moved = this.desk.ledgers.moveTask(project, task.id, move, (entry) => delete entry.held);
    if (typeof moved !== "object") return;
    await this.desk.mail.post(lane.lead, letter);
    recordEvent(project, { kind: `merge.${moved.status}`, task: task.id });
    // Its task is settled, so what the watch told about it is too; its Peer stays with its copy until its Lead releases it.
    if (moved.status === "merged" && task.peer) this.desk.incidents.transact(project, (incidents) => closeSeat(incidents, task.peer!, Date.now()));
    if (moved.status === "merged") await this.merged(project);
  }
}
