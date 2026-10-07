import { clip, hash, outside } from "../../core/text.ts";
import type { Lane } from "../../domain/lane.ts";
import { IN_QUEUE, type Task } from "../../domain/task.ts";
import { type Letter, mail, quoted, say } from "./envelope.ts";

/** A call a seat was told to stop waiting for: the one identity its late answer and its lost answer share. */
type Waited = { agent: string; tool: string; started: number };

/** One sending of a message: keyed by the event, not the words, since the same instruction sent again is a second instruction; `now` cuts into a turn. */
export type Sending = { by: string; to: string; at: number; now?: true };

const sendingIds = (sending: Sending, text: string) => [sending.by, hash(sending.to, text), sending.at];

/** Answers that come as mail, and what reaches a seat from another seat or the Human. */
export const messageLetters = {
  /** The answer to a call that ran longer than the seat that made it could wait for. */
  /** `cut`: the call was stopped on the seat's side before its answer came, rather than outrunning the wait. */
  later(call: Waited, reply: { ok: boolean; text: string }, cut = false): Letter {
    const why = cut
      ? "which was stopped on your side before its answer reached you"
      : "which ran longer than you could wait for it";
    const text = [
      `ANSWER to your ${call.tool} call, ${why}.`,
      "",
      reply.ok ? reply.text : `It was refused: ${reply.text}`,
    ].join("\n");
    return mail(
      "later",
      [hash(call.agent, call.tool, String(call.started))],
      text,
      reply.ok
        ? "Go on from this answer as if the call had just returned it."
        : "Read why it was refused before you call it again.",
    );
  },

  unanswered(call: Waited): Letter {
    return mail(
      "unanswered",
      [hash(call.agent, call.tool, String(call.started))],
      `NO ANSWER to your ${call.tool} call: it was cut off before it finished, so the answer promised by mail will not come.`,
      `Call ${call.tool} again if it still needs doing.`,
    );
  },

  /** Someone's words to their reader, as they wrote them: how to answer is in the reader's prompt. */
  message(text: string, sending: Sending): Letter {
    return say("message", sendingIds(sending, text), text);
  },

  /** The Supervisor may reach a Peer directly but never out of the Lead's sight: this carries what the Lead needs to put its picture right. */
  reconciled(lane: Lane, task: Task, peer: string, text: string, sending: Sending): Letter {
    const accepted =
      task.status === "merged"
        ? `${task.id} is merged already`
        : IN_QUEUE.includes(task.status)
          ? `you have already accepted ${task.id} and it is waiting to merge`
          : `accepting ${task.id} is still yours to judge`;
    const letter = [
      `I've written to the engineer on ${task.id} directly${sending.now ? ", and cut in where they were" : ""}:`,
      "",
      quoted(clip(text, 1500)),
      "",
      `Nothing else changes: ${task.id} (${task.title}) is still ${peer}'s on ${lane.branch}, the lane is still yours, nobody was started or let go, and ${accepted}. If this changes what you were going to do, say so in your next report.`,
    ].join("\n");
    return say("reconcile", ["message", ...sendingIds(sending, text)], letter);
  },

  /** Words the Human wrote straight into a Lead's or Peer's chat, fenced as data. */
  humanWrote(lane: Lane, task: Task | undefined, seat: string, text: string): Letter {
    const closed = lane.status === "closed";
    const who = task
      ? `the engineer on ${task.id} (${task.title})`
      : `the Lead ${closed ? "kept from" : "of"} ${lane.id} (${lane.title})`;
    const then = closed
      ? `Lane ${lane.id} is closed: if it asks for more work, open a lane for it; if it settles the concept, write it into CONTEXT.md.`
      : task
        ? "Its Lead was not told. If it changes what the task or the lane is asked, carry it in: tell the Lead, amend_lane, or settle it with the Human."
        : "If it changes what the lane is asked, carry it in with amend_lane; if it settles the concept, write it into CONTEXT.md.";
    const lines = [
      `The Human wrote to ${who} directly, past you:`,
      "<human>",
      outside("human", text, 1500),
      "</human>",
      "",
      then,
    ];
    return say("humanwrote", [seat, hash(text)], lines.join("\n"));
  },
};
