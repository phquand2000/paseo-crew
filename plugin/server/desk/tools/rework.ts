import { z } from "zod";
import { pristineState, switchTo, uncommittedIn } from "../../core/git.ts";
import { oneLine } from "../../core/text.ts";
import { TASK } from "../../domain/task.ts";
import { no, ok, str } from "../context.ts";
import { repeatsIncident } from "../incidents.ts";
import { holdRefusal } from "../hold.ts";
import { type Ledger, type Task, loadLedger } from "../ledger.ts";
import { letters } from "../letters.ts";
import { tellMoment } from "../moments.ts";
import { holderOf } from "../holder.ts";
import { defineTool } from "../services.ts";
import { bringLaneIn } from "../sync.ts";
import { laneTask } from "./lane-task.ts";

/** Why an accepted task cannot go back to its Peer, if it cannot: that Peer must still be kept on it, in a copy still its own. */
function reopenProblem(ledger: Ledger, task: Task): string | undefined {
  const bound = ledger.agents[task.peer ?? ""];
  if (!bound || bound.gone || bound.task !== task.id) return `The Peer on ${task.id} is gone: add a task for what must change.`;
  const copy = task.slot ? ledger.slots[task.slot] : undefined;
  if (task.mode === "parallel" && (copy?.task !== task.id || copy.releasing)) return `The copy ${task.id} worked in is being put away: add a task for what must change.`;
  return undefined;
}

export const rework = defineTool({
  name: "rework",
  input: z.strictObject({ task: z.string(), text: z.string() }),
  async handle(desk, caller, args) {
    const { ledgers, mail, roster } = desk;
    const text = str(args.text);
    const asked = laneTask(loadLedger(caller.project.state), caller, str(args.task));
    if (typeof asked === "string") return no(asked);
    const refused = repeatsIncident(caller.project.state, asked.task.peer, text);
    if (refused) return no(refused);
    if (!asked.task.peer) return no(`${asked.task.id} has no Peer.`);
    // Asked before anything moves: a task sent back to a seat that is gone would wait for nobody.
    if (!(await roster.seated(asked.task.peer))) return no(asked.task.status === "merged" ? `The Peer on ${asked.task.id} is gone: add a task for what must change.` : `The Peer on ${asked.task.id} is gone; cut the task and start a new one.`);
    // Sent back after its merge, a task in the lane's copy takes that copy onto its branch again: nothing may be left in it.
    const inLaneCopy = asked.task.status === "merged" && asked.task.mode !== "parallel" && !holderOf(loadLedger(caller.project.state), asked.lane, asked.task.id) && asked.lane.worktree;
    if (inLaneCopy && (await pristineState(inLaneCopy)) !== "clean") return no(`The lane's working copy has work uncommitted (${await uncommittedIn(inLaneCopy)}), so ${asked.task.id} cannot go back onto its branch there. Clear it, then send it back.`);
    const result = ledgers.transact(caller.project, (ledger): Task | string => {
      const found = laneTask(ledger, caller, str(args.task));
      if (typeof found === "string") return found;
      const { lane, task } = found;
      const held = holdRefusal(lane);
      if (held) return held;
      if (!TASK.may(task.status, "rework")) return `${task.id} is ${task.status}.`;
      const reopened = task.status === "merged";
      const problem = reopened ? reopenProblem(ledger, task) : undefined;
      if (problem) return problem;
      const holder = task.mode === "parallel" ? undefined : holderOf(ledger, lane, task.id);
      if (holder) return `${holder.id} holds the lane's working copy; waking the Peer on ${task.id} in there would put two writers in one checkout. Accept or cut ${holder.id} first.`;
      TASK.move(task, "rework");
      if (reopened) delete lane.ready;
      task.silent = 0;
      task.reworks = (task.reworks ?? 0) + 1;
      task.updatedAt = Date.now();
      return { ...task };
    });
    if (typeof result === "string") return no(result);
    // Reopened, it takes up the lane as it stands now, on its own branch; one that cannot is brought up to date at its hand-back.
    if (asked.task.status === "merged" && result.worktree && result.branch) {
      const refused = inLaneCopy ? await switchTo(inLaneCopy, result.branch, asked.lane.branch) : undefined;
      if (!refused) await bringLaneIn({ ...result, worktree: result.worktree, branch: result.branch }, asked.lane);
    }
    // Keyed by the rework's count, each letter is its own: none is dropped as a repeat.
    await mail.post(result.peer, letters.rework(result, text));
    if (result.reworks === 2) await tellMoment(desk, caller.project, result, "STRUGGLING", `its Lead sent it back a second time: ${oneLine(text)}`);
    return ok(`Rework sent to the Peer on ${result.id}; its next hand-back arrives as mail.`);
  },
});
