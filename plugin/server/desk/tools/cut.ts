import { recordEvent } from "../store/event-log.ts";
import { z } from "zod";
import { no, ok, str } from "../context.ts";
import { letGo } from "../gone.ts";
import { loadLedger } from "../ledger.ts";
import { defineTool } from "../services.ts";
import { leaveCopy } from "../sync.ts";
import { startWaiting } from "../waiting/tasks.ts";
import { laneTask } from "./lane-task.ts";

export const cut = defineTool({
  name: "cut",
  input: z.strictObject({ task: z.string(), reason: z.string() }),
  async handle(desk, caller, args) {
    const { ledgers, roster, slots } = desk;
    const { project } = caller;
    const ledger = loadLedger(project.state);
    const found = laneTask(ledger, caller, str(args.task));
    if (typeof found === "string") return no(found);
    const { lane, task } = found;
    const updated = ledgers.moveTask(project, task.id, "cut");
    if (updated === undefined) return no(`${task.id} is gone.`);
    if (updated === "merging")
      return no(
        `${task.id} is being merged, and a cut would not stop its work landing. How the merge went arrives as mail.`,
      );
    if (typeof updated === "string") return no(`${task.id} is already ${updated}.`);
    await letGo(desk, roster, project, task.peer, true);
    const left =
      task.kind !== "code"
        ? undefined
        : task.mode === "parallel"
          ? { kept: await slots.release(project, task.slot, task.branch, lane.branch) }
          : await leaveCopy(lane, task);
    const kept = left?.kept;
    recordEvent(project, { kind: "task.cut", task: task.id, reason: str(args.reason), kept });
    const copy =
      task.mode === "parallel" || !left
        ? ""
        : left.refused
          ? ` The lane's working copy could not go back on ${lane.branch}: ${left.refused}.`
          : ` The lane's working copy is back on ${lane.branch}.`;
    const branch = kept ? ` Its branch ${kept} holds commits nothing else has and is kept.` : "";
    await startWaiting(desk, project, true);
    return ok(`${task.id} is cut and its agent stopped.${copy}${branch}`);
  },
});
