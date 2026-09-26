import { taskBrief } from "./briefs.ts";
import type { Lane, Task } from "./ledger.ts";
import { type Letter, fyi, mail } from "./letters.ts";

/** What the desk mails a seat kept on after its work: a Peer's next task, a Lead's closed lane. */
export const keptLetters = {
  /** A task handed to the Peer kept in the lane's copy: its brief, as a new Peer gets it for its first prompt. */
  brief(task: Task, lane: Lane, beside: Task[]): Letter {
    return mail("brief", [task.id], taskBrief(task, lane, beside, true), "This is your next task, in the same working copy: what you learned on the last one still holds where this brief does not say otherwise.");
  },

  /** Its lane closed under it, which asks nothing of it now: read with whatever wakes it next. */
  closed(lane: Lane, landed: boolean, how: string): Letter {
    const text = `LANE CLOSED ${lane.id} (${lane.title}): ${landed ? "landed" : "dropped"}; ${how}. Its Peers are let go, and you stay on with what you know of it until the owner releases you.`;
    return fyi(mail("closed", [lane.id], text, "Nothing of the lane is yours to do now: answer whoever writes to you about it."));
  },
};
