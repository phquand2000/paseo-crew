import { fileKinds } from "../../catalog/kit/patterns.ts";
import { changedFiles, commitsAhead, currentBranch, diffCounts, headSha, uncommittedIn } from "../../core/git.ts";
import { advance, mergeCommit } from "../../core/land.ts";
import { TASK } from "../../domain/task.ts";
import type { DeskBase } from "../base.ts";
import { gateNote, taskGate } from "../project/gates.ts";
import { closeSeat } from "../store/incidents.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { othersLeft } from "../../domain/ledger.ts";
import type { Letter } from "../letters/envelope.ts";
import { mergeLetters } from "../letters/merge-letters.ts";
import { type Project, serialIn } from "../project.ts";
import { reachNotes } from "./reach.ts";
import { recordEvent } from "../store/event-log.ts";
import { backOnLane, bringLaneIn } from "../copies/sync.ts";

type Outcome = "merged" | "conflict" | "red" | "fail";

/** A gate verdict on a task's branch, with the failing run's tail when this merge ran it. */
type Verdict = { ok: boolean; note: string; over?: string; run?: { tail: string; logFile: string } };

export type MergeDesk = Pick<DeskBase, "kit" | "ledgers" | "incidents" | "mail" | "log">;

/** Merges one accepted task into its lane: the lane brought into the task's copy, gated there, then taken on as it is. */
export class TaskMerge {
  private readonly desk: MergeDesk;
  private readonly merged: (project: Project) => Promise<void>;

  constructor(desk: MergeDesk, merged: (project: Project) => Promise<void>) {
    this.desk = desk;
    this.merged = merged;
  }

  /** Merges the task, or settles what stops it; nothing lands in a lane on hold. */
  async run(project: Project, taskId: string): Promise<void> {
    const picked = this.pick(project, taskId);
    if (!picked) return;
    const { task, lane } = picked;
    const cwd = lane.worktree;
    if (!cwd) return this.fail(project, task, lane, "the lane has no working copy");
    if (!task.branch || !task.worktree)
      return this.fail(project, task, lane, "the task's branch or copy is not on record");
    const at = await this.cleared(project, { ...task, branch: task.branch, worktree: task.worktree }, lane);
    if (!at) return;
    const ahead = await commitsAhead(cwd, at, task.branch);
    if (ahead === undefined)
      return this.fail(project, task, lane, `git could not count what ${task.branch} carries beyond the lane branch`);
    // Nothing committed beyond the lane is a task that changed nothing: the Lead's accept stands.
    if (ahead === 0) return this.landed(project, task, lane, cwd, { before: at, after: at });
    return this.mergeOnto(project, { ...task, branch: task.branch }, lane, cwd, at);
  }

  /** The task, moved to merging; nothing when it is gone, or its lane is on hold and it waits queued for resume_lane. */
  private pick(project: Project, taskId: string): { task: Task; lane: Lane } | undefined {
    return this.desk.ledgers.transact(project, (ledger) => {
      const task = ledger.tasks[taskId];
      const lane = task ? ledger.lanes[task.lane] : undefined;
      if (!task || !lane) return undefined;
      if (lane.onHold) {
        if (task.status === "queued") task.held = { why: "its lane is on hold" };
        return undefined;
      }
      if (!TASK.move(task, "merge")) return undefined;
      return { task: { ...task }, lane: { ...lane } };
    });
  }

  /** Its branch carries the lane's tip it was gated with, so the lane takes that very tree, moved only from that tip. */
  private async mergeOnto(
    project: Project,
    task: Task & { branch: string },
    lane: Lane,
    cwd: string,
    at: string,
  ): Promise<void> {
    const made = await mergeCommit(cwd, at, task.branch, `Merge ${task.id}: ${task.title}`);
    if (!made) return this.fail(project, task, lane, "git could not make the merge commit");
    const stopped = await advance(cwd, lane.branch, at, made);
    if (stopped?.why === "moved") {
      const why = `${lane.branch} moved while it was gated, so it goes round again with that brought in`;
      return this.hold(project, task, lane, why, false);
    }
    if (stopped?.why === "dirty") return this.waitFor(project, task, lane, cwd);
    if (stopped) {
      const unread = stopped.detail ?? `git could not read the lane's working copy at ${cwd}`;
      const reason = stopped.why === "elsewhere" ? `${lane.branch} is checked out in another working copy` : unread;
      return this.fail(project, task, lane, reason);
    }
    await this.landed(project, task, lane, cwd, { before: at, after: made });
  }

  /**
   * The lane tip the task may merge onto now: its lane brought into its copy, and a green gate there or its Lead's word
   * over a red one. What stops it is settled here: conflicts left for its Peer, a copy that cannot take the lane, a red gate.
   */
  private async cleared(
    project: Project,
    task: Task & { branch: string; worktree: string },
    lane: Lane,
  ): Promise<string | undefined> {
    const synced = await bringLaneIn(task, lane);
    if ("conflicts" in synced) {
      const letter = mergeLetters.conflict(task, synced.conflicts, lane.branch, "left", synced.by);
      await this.finish(project, task, lane, "conflict", letter);
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
    if (verdict?.over !== undefined) {
      const by = lane.lead ?? "";
      recordEvent(project, { kind: "gate.overridden", lane: lane.id, by, task: task.id, reason: verdict.over });
    }
    return synced.at;
  }

  /** The gate's verdict on the task's head: its hand-back's when that ran on the same commit, else one run now and kept. */
  private async verdict(project: Project, task: Task & { worktree: string }, lane: Lane): Promise<Verdict | undefined> {
    const head = await headSha(task.worktree);
    const last = task.handback?.gate;
    if (last && last.sha === head) return last;
    const files = await changedFiles(task.worktree, `${lane.branch}...HEAD`);
    const run = await taskGate(this.desk.kit, project, task.id, task.worktree, files);
    if (!run) return undefined;
    this.desk.ledgers.setTask(project, task.id, (entry) => {
      if (entry.handback) entry.handback.gate = { ok: run.ok, note: run.note, sha: head };
    });
    return { ok: run.ok, note: run.note, run: { tail: run.tail, logFile: run.logFile } };
  }

  /** The lane branch is checked out in the lane's copy with work left there: the merge would move files under it. */
  private async waitFor(project: Project, task: Task, lane: Lane, cwd: string): Promise<void> {
    await this.hold(
      project,
      task,
      lane,
      `the lane's working copy has uncommitted changes (${await uncommittedIn(cwd)})`,
    );
  }

  /**
   * The Lead's accept stands: the task waits queued for `why` to clear and is tried again as each turn ends. Its Lead is
   * told once for each reason, woken only when `why` is something to clear.
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
  async landed(
    project: Project,
    task: Task,
    lane: Lane,
    cwd: string,
    merged: { before: string; after: string },
  ): Promise<void> {
    const counts = await diffCounts(cwd, merged.before, merged.after, fileKinds(this.desk.kit));
    const serial = await serialIn(this.desk.kit, project, cwd);
    this.desk.ledgers.transact(project, (ledger) => {
      const entry = ledger.tasks[task.id];
      if (entry) Object.assign(entry, { mergeSha: merged.after, updatedAt: Date.now() });
      // The lane branch moved: what its Lead reported ready is not what it holds now.
      if (merged.after !== merged.before) delete ledger.lanes[lane.id]?.ready;
    });
    // A task in the lane's copy gives it back to the lane branch: the same tree, so nothing in it changes.
    if (task.mode !== "parallel" && (await currentBranch(cwd)) === task.branch) await backOnLane(lane);
    const now = loadLedger(project.state);
    // The gate ran before the merge, on the tree it made; the verdict on record, or its Lead's word over it, is what it says.
    const gate = gateNote(project, now.tasks[task.id] ?? task);
    const reach = reachNotes(now, task, lane, counts?.files ?? [], serial);
    const letter = mergeLetters.merged(task, counts, reach, gate, othersLeft(now, task).length === 0);
    await this.finish(project, task, lane, "merged", letter);
  }

  /** Fails the merge for `reason`. */
  fail(project: Project, task: Task, lane: Lane, reason: string): Promise<void> {
    return this.finish(project, task, lane, "fail", mergeLetters.mergeFailed(task, reason, ""));
  }

  /** The record follows what the merge did, and its Lead is told. */
  private async finish(project: Project, task: Task, lane: Lane, move: Outcome, letter: Letter): Promise<void> {
    const moved = this.desk.ledgers.moveTask(project, task.id, move, (entry) => delete entry.held);
    if (typeof moved !== "object") return;
    await this.desk.mail.post(lane.lead, letter);
    recordEvent(project, { kind: `merge.${moved.status}`, task: task.id });
    if (moved.status !== "merged") return;
    // Its task is settled, so what the watch told about it is too; its Peer stays with its copy until its Lead releases it.
    if (task.peer) this.desk.incidents.transact(project, (book) => closeSeat(book, task.peer!, Date.now()));
    await this.merged(project);
  }
}
