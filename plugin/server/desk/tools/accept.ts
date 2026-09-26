import { z } from "zod";
import { currentBranch, headSha, pristineState, uncommittedIn } from "../../core/git.ts";
import { AT_WORK, IN_QUEUE, TASK } from "../../domain/task.ts";
import { type Args, type ToolReply, no, ok, str } from "../context.ts";
import { holdRefusal } from "../hold.ts";
import { type Task, loadLedger } from "../ledger.ts";
import type { Project } from "../project.ts";
import { type DeskServices, defineTool } from "../services.ts";
import { laneTask } from "../access.ts";

/** A task goes into its lane's merge queue once handed back, and over a red gate on its tree only with its Lead's reason. */
async function queueTask(desk: DeskServices, project: Project, task: Task, args: Args): Promise<ToolReply> {
  const { ledgers, merges } = desk;
  if (AT_WORK.includes(task.status) || !task.handback)
    return no(`${task.id} is not handed back: accept it once its Peer hands it back, or cut it.`);
  // A copy off its branch (mid-bisect) has commits on no branch; clean and detached is not work the merge would take.
  if (task.worktree && task.branch && (await currentBranch(task.worktree)) !== task.branch) {
    return no(
      `${task.id}'s working copy is not on ${task.branch}, so nothing committed in it is on its branch. If its Peer bisected, send rework asking it to run git bisect reset, which takes the copy back to ${task.branch}, and to commit its work there; then accept it again. A copy that left some other way is not the Peer's to put back: raise it with ask.`,
    );
  }
  // Only what is committed merges: work left beside it would be lost to the lane, and a copy that goes back to it carries it on.
  const copy = task.worktree ? await pristineState(task.worktree) : "clean";
  if (copy !== "clean")
    return no(
      `${task.id}'s working copy ${copy === "dirty" ? `has work uncommitted (${await uncommittedIn(task.worktree!)})` : "could not be read by git"}: send rework asking its Peer to commit what belongs to it, then accept it again.`,
    );
  const over = args.overGate === true;
  if (over && !str(args.reason)) return no("Say why in reason: merging over a red gate is yours to explain.");
  const gate = task.handback.gate;
  if (
    gate?.ok === false &&
    !over &&
    gate.sha === (task.branch ? await headSha(project.root, task.branch) : undefined)
  ) {
    return no(
      `${task.id}'s gate is red on the tree the lane would become: send it back with rework, or accept it with overGate and a reason to merge it over the gate.`,
    );
  }
  const queued = ledgers.moveTask(project, task.id, "queue", (entry) => {
    entry.acceptedAt = Date.now();
    if (over && entry.handback?.gate?.ok === false) entry.handback.gate.over = str(args.reason);
  });
  if (typeof queued !== "object") return no(`${task.id} is ${queued ?? "gone"}.`);
  const ahead =
    Object.values(loadLedger(project.state).tasks).filter(
      (entry) => entry.lane === task.lane && IN_QUEUE.includes(entry.status),
    ).length - 1;
  merges.enqueue(project, task.id);
  return ok(
    `${task.id} is in the merge queue${ahead > 0 ? ` behind ${ahead}` : ""}. MERGED, MERGE RED, MERGE WAITS or MERGE FAILED arrives as mail.`,
  );
}

export const accept = defineTool({
  name: "accept",
  input: z.strictObject({ task: z.string(), overGate: z.boolean().optional(), reason: z.string().optional() }),
  async handle(desk, caller, args) {
    const { project } = caller;
    const found = laneTask(loadLedger(project.state), caller, str(args.task));
    if (typeof found === "string") return no(found);
    const { lane, task } = found;
    const held = holdRefusal(lane);
    if (held) return no(held);
    if (task.kind !== "code") return no(`${task.id} is a review; cut it when you are done with it.`);
    if (!TASK.may(task.status, "queue")) return no(`${task.id} is ${task.status}.`);
    return queueTask(desk, project, task, args);
  },
});
