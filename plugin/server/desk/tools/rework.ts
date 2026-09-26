import { z } from "zod";
import { oneLine } from "../../core/text.ts";
import { TASK } from "../../domain/task.ts";
import { no, ok, str } from "../context.ts";
import { repeatsIncident } from "../incidents.ts";
import { type Task, loadLedger } from "../ledger.ts";
import { letters } from "../letters.ts";
import { tellMoment } from "../moments.ts";
import { holderOf } from "../holder.ts";
import { defineTool } from "../services.ts";
import { laneTask } from "./lane-task.ts";

export const rework = defineTool({
  name: "rework",
  input: z.strictObject({ task: z.string(), text: z.string() }),
  async handle(desk, caller, args) {
    const { ctx, roster } = desk;
    const text = str(args.text);
    const asked = laneTask(loadLedger(caller.project.state), caller, str(args.task));
    const refused = typeof asked === "string" ? undefined : repeatsIncident(caller.project.state, asked.task.peer, text);
    if (refused) return no(refused);
    const result = ctx.transact(caller.project, (ledger): Task | string => {
      const found = laneTask(ledger, caller, str(args.task));
      if (typeof found === "string") return found;
      const { lane, task } = found;
      if (!TASK.may(task.status, "rework")) return `${task.id} is ${task.status}.`;
      const holder = task.mode === "parallel" ? undefined : holderOf(ledger, lane, task.id);
      if (holder) return `${holder.id} holds the lane's working copy; waking the Peer on ${task.id} in there would put two writers in one checkout. Accept or cut ${holder.id} first.`;
      TASK.move(task, "rework");
      task.silent = 0;
      task.reworks = (task.reworks ?? 0) + 1;
      task.updatedAt = Date.now();
      return { ...task };
    });
    if (typeof result === "string") return no(result);
    if (!result.peer) return no(`${result.id} has no Peer.`);
    const seat = await roster.look(result.peer);
    if (seat.archivedAt) return no(`The Peer on ${result.id} is gone; cut the task and start a new one.`);
    const posted = await ctx.post(result.peer, letters.rework(result, text));
    if (result.reworks === 2 && posted !== "duplicate") await tellMoment(desk, caller.project, result, "STRUGGLING", `its Lead sent it back a second time: ${oneLine(text)}`);
    return posted === "duplicate"
      ? no(`That rework was already sent to the Peer on ${result.id} and it has not ended a turn since, so this would be the same letter twice. Wait for its hand-back, or cut it.`)
      : ok(`Rework sent to the Peer on ${result.id}; its next hand-back arrives as mail.`);
  },
});
