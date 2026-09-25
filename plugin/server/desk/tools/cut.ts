import { z } from "zod";
import { git, resetHard } from "../../core/git.ts";
import { no, ok, str } from "../context.ts";
import { letGo } from "../gone.ts";
import { loadLedger } from "../ledger.ts";
import { defineTool } from "../services.ts";
import { startWaiting } from "../waiting.ts";
import { laneTask } from "./lane-task.ts";

export const cut = defineTool({
  name: "cut",
  input: z.strictObject({ task: z.string(), reason: z.string() }),
  async handle(desk, caller, args) {
    const { ctx, roster, slots } = desk;
    const { project } = caller;
    const ledger = loadLedger(project.state);
    const found = laneTask(ledger, caller, str(args.task));
    if (typeof found === "string") return no(found);
    const { lane, task } = found;
    const updated = ctx.moveTask(project, task.id, "cut");
    if (updated === undefined) return no(`${task.id} is gone.`);
    if (updated === "merging") return no(`${task.id} is being merged, and a cut would not stop its work landing. How the merge went arrives as mail.`);
    if (typeof updated === "string") return no(`${task.id} is already ${updated === "merged" ? "accepted" : "cut"}.`);
    await letGo(ctx, roster, project, task.peer, true);
    let undone = "";
    if (task.kind === "code" && task.mode === "lane" && task.startSha && lane.worktree) {
      // Resetting to the task's start would also drop later merges whose Peers were told their work was in.
      const since = Object.values(ledger.tasks).filter((other) => other.lane === lane.id && other.id !== task.id && other.status === "merged" && other.updatedAt > task.openedAt);
      if (since.length > 0) {
        undone = ` Its writing is left in the lane's working copy: ${since.map((other) => other.id).join(", ")} landed there after ${task.id} started, and going back to ${task.startSha.slice(0, 7)} would take that too. Undo what you want gone.`;
      } else {
        await resetHard(lane.worktree, task.startSha);
        await git(lane.worktree, ["clean", "-fd"]);
        undone = ` The lane's working copy is back at ${task.startSha.slice(0, 7)}.`;
      }
    }
    const kept = task.kind === "code" && task.mode === "parallel" ? await slots.release(project, task.slot, task.branch, lane.branch) : undefined;
    ctx.event(project, { kind: "task.cut", task: task.id, reason: str(args.reason), kept });
    const branch = kept ? ` Its branch ${kept} holds commits nothing else has and is kept.` : "";
    await startWaiting(desk, project, true);
    return ok(`${task.id} is cut and its agent stopped.${undone}${branch}`);
  },
});
