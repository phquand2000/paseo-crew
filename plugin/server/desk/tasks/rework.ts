import { pristineState, switchTo, uncommittedIn } from "../../core/git.ts";
import { oneLine } from "../../core/text.ts";
import { TASK } from "../../domain/task.ts";
import { laneTask } from "../access.ts";
import { type Caller, type ToolReply, no, ok, str } from "../context.ts";
import { holdRefusal } from "../hold.ts";
import { holderOf } from "../holder.ts";
import { repeatsIncident } from "../incidents.ts";
import { type Lane, type Ledger, type Task, loadLedger } from "../ledger.ts";
import { letters } from "../letters.ts";
import { tellMoment } from "../moments.ts";
import type { DeskServices } from "../services.ts";
import { bringLaneIn } from "../sync.ts";

/** A rework call as the tool takes it. */
type ReworkCall = { task: string; text: string };

/** Sends a task back to its Peer with what must change; a merged task goes back only to a Peer kept on it. */
export async function reworkTask(desk: DeskServices, caller: Caller, args: ReworkCall): Promise<ToolReply> {
  const text = str(args.text);
  const asked = laneTask(loadLedger(caller.project.state), caller, str(args.task));
  if (typeof asked === "string") return no(asked);
  const refused = repeatsIncident(caller.project.state, asked.task.peer, text);
  if (refused) return no(refused);
  if (!asked.task.peer) return no(`${asked.task.id} has no Peer.`);
  // Asked before anything moves: a task sent back to a seat that is gone would wait for nobody.
  if (!(await desk.roster.seated(asked.task.peer)))
    return no(
      asked.task.status === "merged"
        ? `The Peer on ${asked.task.id} is gone: add a task for what must change.`
        : `The Peer on ${asked.task.id} is gone; cut the task and start a new one.`,
    );
  // Sent back after its merge, a task in the lane's copy takes that copy onto its branch again: nothing may be left in it.
  const inLaneCopy = laneCopyToReopen(loadLedger(caller.project.state), asked.lane, asked.task);
  if (inLaneCopy && (await pristineState(inLaneCopy)) !== "clean")
    return no(
      `The lane's working copy has work uncommitted (${await uncommittedIn(inLaneCopy)}), so ${asked.task.id} cannot go back onto its branch there. Clear it, then send it back.`,
    );
  const result = sendBack(desk, caller, str(args.task));
  if (typeof result === "string") return no(result);
  // Reopened, it takes up the lane as it stands now, on its own branch; one that cannot is brought up to date at its hand-back.
  if (asked.task.status === "merged" && result.worktree && result.branch) {
    const switched = inLaneCopy ? await switchTo(inLaneCopy, result.branch, asked.lane.branch) : undefined;
    if (!switched) await bringLaneIn({ ...result, worktree: result.worktree, branch: result.branch }, asked.lane);
  }
  // Keyed by the rework's count, each letter is its own: none is dropped as a repeat.
  await desk.mail.post(result.peer, letters.rework(result, text));
  if (result.reworks === 2)
    await tellMoment(
      desk,
      caller.project,
      result,
      "STRUGGLING",
      `its Lead sent it back a second time: ${oneLine(text)}`,
    );
  return ok(`Rework sent to the Peer on ${result.id}; its next hand-back arrives as mail.`);
}

/** The lane's copy a merged task goes back into, when it worked there and nobody else holds it now. */
function laneCopyToReopen(ledger: Ledger, lane: Lane, task: Task): string | undefined {
  if (task.status !== "merged" || task.mode === "parallel" || holderOf(ledger, lane, task.id)) return undefined;
  return lane.worktree;
}

/** Moves the task back to rework under the lock, or says what stops it: a hold, its status, its Peer or copy gone, another writer. */
function sendBack({ ledgers }: Pick<DeskServices, "ledgers">, caller: Caller, id: string): Task | string {
  return ledgers.transact(caller.project, (ledger): Task | string => {
    const found = laneTask(ledger, caller, id);
    if (typeof found === "string") return found;
    const { lane, task } = found;
    const held = holdRefusal(lane);
    if (held) return held;
    if (!TASK.may(task.status, "rework")) return `${task.id} is ${task.status}.`;
    const reopened = task.status === "merged";
    const problem = reopened ? reopenProblem(ledger, task) : undefined;
    if (problem) return problem;
    const holder = task.mode === "parallel" ? undefined : holderOf(ledger, lane, task.id);
    if (holder)
      return `${holder.id} holds the lane's working copy; waking the Peer on ${task.id} in there would put two writers in one checkout. Accept or cut ${holder.id} first.`;
    TASK.move(task, "rework");
    if (reopened) delete lane.ready;
    task.silent = 0;
    task.reworks = (task.reworks ?? 0) + 1;
    task.updatedAt = Date.now();
    return { ...task };
  });
}

/** Why an accepted task cannot go back to its Peer: that Peer must still be kept on it, in a copy still its own. */
function reopenProblem(ledger: Ledger, task: Task): string | undefined {
  const bound = ledger.agents[task.peer ?? ""];
  if (!bound || bound.gone || bound.task !== task.id)
    return `The Peer on ${task.id} is gone: add a task for what must change.`;
  const copy = task.slot ? ledger.slots[task.slot] : undefined;
  if (task.mode === "parallel" && (copy?.task !== task.id || copy.releasing))
    return `The copy ${task.id} worked in is being put away: add a task for what must change.`;
  return undefined;
}
