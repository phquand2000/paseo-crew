import { clip, hash, outside } from "../../core/text.ts";
import type { Lane } from "../../domain/lane.ts";
import { IN_QUEUE, type Task } from "../../domain/task.ts";
import { type Letter, mail } from "./envelope.ts";

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

  /** `reader` answers only through its own tools: words it says in its turn reach nobody. */
  message(from: string, text: string, sending: Sending, reader: "worker" | "lead"): Letter {
    const next =
      reader === "worker"
        ? "Carry it into your work from now on, and answer what it asks in your hand-back, or with ask if a reply cannot wait."
        : "Carry it into your lane from now on, and answer what it asks with report, or with ask if you need a decision back first.";
    const writer = `${from[0]!.toUpperCase()}${from.slice(1)}`;
    return mail("message", sendingIds(sending, text), [`${writer} writes:`, "", text].join("\n"), next);
  },

  /** The Supervisor may reach a Peer directly but never out of the Lead's sight: this carries what the Lead needs to put its picture right. */
  reconciled(lane: Lane, task: Task, peer: string, text: string, sending: Sending): Letter {
    const letter = [
      `RECONCILE ${lane.id}: the owner reached your Peer on ${task.id} directly.`,
      "",
      sending.now
        ? "What reached them, sent now: it interrupts the Peer where that can be done."
        : "What reached them:",
      clip(text, 1500),
      "",
      `Current intent: ${lane.outcome}`,
      `Ownership: ${task.id} (${task.title}) is still owned by ${peer}, on ${lane.branch}. The lane is still yours.`,
      "Topology: unchanged. Nobody was started, moved or let go.",
      task.status === "merged"
        ? `Integration and acceptance: ${task.id} is merged already, and nothing here changed that.`
        : IN_QUEUE.includes(task.status)
          ? `Integration and acceptance: you have already accepted ${task.id} and it is waiting to merge; nothing here changed that.`
          : `Integration and acceptance: unchanged. Accepting ${task.id} is still yours to judge, and nothing here accepted it.`,
    ].join("\n");
    return mail(
      "reconcile",
      ["message", ...sendingIds(sending, text)],
      letter,
      "If this changes what you were going to do, say so in your next report.",
    );
  },

  /** Words the Human wrote straight into a Lead's or Peer's chat, fenced as data. */
  humanWrote(lane: Lane, task: Task | undefined, seat: string, text: string): Letter {
    const closed = lane.status === "closed";
    const who = task
      ? `the Peer on ${task.id} (${task.title})`
      : `the Lead ${closed ? "kept from" : "of"} ${lane.id} (${lane.title})`;
    const lines = [
      `HUMAN WROTE to ${who} directly, past you:`,
      "<human>",
      outside("human", text, 1500),
      "</human>",
      ...(task ? ["", "Its Lead was not told."] : []),
    ];
    const next = closed
      ? `Lane ${lane.id} is closed: if it asks for more work, open a lane for it; if it settles the concept, write it into CONTEXT.md.`
      : task
        ? "If it changes what the task or the lane is asked, carry it in: tell the Lead, amend_lane, or settle it with the Human."
        : "If it changes what the lane is asked, carry it in with amend_lane; if it settles the concept, write it into CONTEXT.md.";
    return mail("humanwrote", [seat, hash(text)], lines.join("\n"), next);
  },
};
