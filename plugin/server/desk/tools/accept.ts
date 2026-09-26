import { z } from "zod";
import { fileKinds } from "../../catalog/kit.ts";
import { currentBranch, outsideOwned, ownCounts, pristineState, uncommittedIn } from "../../core/git.ts";
import { IN_QUEUE, TASK } from "../../domain/task.ts";
import { no, ok, str } from "../context.ts";
import { gateNote } from "../gates.ts";
import { loadLedger, othersLeft } from "../ledger.ts";
import { mergeLetters } from "../merge-letters.ts";
import { closeIncidentsOf } from "../notice.ts";
import { holderOf } from "../holder.ts";
import { defineTool } from "../services.ts";
import { startWaiting } from "../waiting.ts";
import { laneTask } from "./lane-task.ts";

export const accept = defineTool({
  name: "accept",
  input: z.strictObject({ task: z.string() }),
  async handle(desk, caller, args) {
    const { ctx, merges } = desk;
    const { project } = caller;
    const found = laneTask(loadLedger(project.state), caller, str(args.task));
    if (typeof found === "string") return no(found);
    const { lane, task } = found;
    if (lane.onHold) return no(`Lane ${lane.id} is on hold: ${lane.onHold.reason}. Nothing is accepted, started or landed in it until it resumes.`);
    if (task.kind !== "code") return no(`${task.id} is a review; cut it when you are done with it.`);
    if (!TASK.may(task.status, task.mode === "parallel" ? "queue" : "accept")) return no(`${task.id} is ${task.status}.`);
    if (task.mode === "parallel") {
      const queued = ctx.moveTask(project, task.id, "queue", (entry) => (entry.acceptedAt = Date.now()));
      if (typeof queued !== "object") return no(`${task.id} is ${queued ?? "gone"}.`);
      const ahead = Object.values(loadLedger(project.state).tasks).filter((entry) => IN_QUEUE.includes(entry.status)).length - 1;
      merges.enqueue(project, task.id);
      return ok(`${task.id} is in the merge queue${ahead > 0 ? ` behind ${ahead}` : ""}. MERGED, MERGE WAITS or MERGE FAILED arrives as mail.`);
    }
    // A copy off the lane branch (mid-bisect) has commits on no branch; clean and detached is not landed.
    if (lane.worktree && (await currentBranch(lane.worktree)) !== lane.branch) {
      return no(
        `The lane's working copy is not on ${lane.branch}, so nothing committed in it is on the lane branch. If its Peer bisected, send rework asking the Peer on ${task.id} to run git bisect reset, which takes the copy back to ${lane.branch}, and to commit its work there; then accept again. A copy that left some other way is not the Peer's to put back: raise it with ask.`,
      );
    }
    if (!lane.worktree) return no(`Lane ${lane.id} has no working copy.`);
    const copy = await pristineState(lane.worktree);
    if (copy === "unknown") return no(`git could not read the lane's working copy at ${lane.worktree}, so the desk cannot tell whether anything is uncommitted there.`);
    if (copy === "dirty") {
      // Named correctly: the uncommitted work may be another task's, and reworking this one would wake its Peer into it.
      const other = holderOf(loadLedger(project.state), lane, task.id);
      return no(
        other
          ? `The lane's working copy has uncommitted changes, and ${other.id} is the task holding it — they are not ${task.id}'s. Accept ${task.id} once ${other.id} has handed back and been accepted or cut.`
          : `The lane's working copy has uncommitted changes: ${await uncommittedIn(lane.worktree)}. Send rework asking the Peer on ${task.id} for those, then accept again.`,
      );
    }
    const counts = await ownCounts(lane.worktree, task.startSha ?? lane.base, fileKinds(ctx.kit));
    // Not rerun: a per-task gate already gave the Lead its verdict with the hand-back.
    const gate = gateNote(project, task);
    const updated = ctx.moveTask(project, task.id, "accept", (entry) => (entry.acceptedAt = Date.now()));
    if (typeof updated !== "object") return no(`${task.id} is ${updated ?? "gone"}.`);
    const last = othersLeft(loadLedger(project.state), task).length === 0;
    await ctx.post(lane.lead, mergeLetters.merged(task, counts, outsideOwned(counts?.files ?? [], task.owned), gate, last));
    // Its task is settled, so what the watch told about it is too: the next task starts with a clean book.
    if (task.peer) closeIncidentsOf(desk, project, task.peer);
    ctx.event(project, { kind: "task.accepted", task: task.id, mode: "lane" });
    await startWaiting(desk, project, true);
    const where = counts && counts.files.length === 0 ? `it changed nothing, so ${lane.branch} stands where it did` : `its commits are already on ${lane.branch}`;
    return ok(
      `${task.id} is accepted; ${where}. The working copy is free for the next task. Its Peer stays in the copy with what it learned: the next task there goes to it unless you add that one fresh, and release lets it go.`,
    );
  },
});
