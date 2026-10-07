import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { type Letter, fyi, mail, say } from "./envelope.ts";

/** What the desk mails a seat kept on after its work: a Lead whose lane closed, a Peer its Lead gave another task. */
export const keptLetters = {
  /** Its lane closed under it, which asks nothing of it now: read with whatever wakes it next. */
  closed(lane: Lane, landed: boolean, how: string): Letter {
    const text = `LANE CLOSED ${lane.id} (${lane.title}): ${landed ? "landed" : "dropped"}; ${how}. Its engineers are let go, and you stay on with what you know of it until the owner releases you.`;
    return fyi(
      mail("closed", [lane.id], text, "Nothing of the lane is yours to do now: answer whoever writes to you about it."),
    );
  },
  /** The brief of the task a kept Peer starts on, in the chat it worked its last task in. */
  next(task: Task, from: string, brief: string): Letter {
    const text = `${brief}\n\nYour Lead gives you this after ${from}: you are in the same working copy, now on ${task.branch}.`;
    return mail(
      "brief",
      [task.id],
      text,
      `Work ${task.id} now: what you learned on ${from} holds where this brief does not say otherwise.`,
    );
  },
  /** Whoever supervises lets a Lead's kept Peer go: told before it goes, which asks nothing of the Lead. */
  released(task: Task, peer: string): Letter {
    const text = `I've let ${peer} go, the engineer you kept on after ${task.id} (${task.title}). A task that named them starts on a new engineer.`;
    return fyi(say("released", [task.id, peer], text));
  },
};
