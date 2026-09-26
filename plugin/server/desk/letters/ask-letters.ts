import type { Question } from "../../domain/question.ts";
import type { Ask } from "../../domain/ask.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Letter, firstLine, mail } from "./letters.ts";

const theirDefault = (ask: Ask): string[] => (ask.default ? ["", `Their default: ${ask.default}`] : []);

/** What whoever supervises does with an ask: a Peer's reaches it only when its Lead is gone, and a question may be the Human's. */
function askNext(ask: Ask): string {
  if (ask.task)
    return `Its Lead is gone: answer ${ask.id} if you can; replace_lead puts a new Lead on the lane where it stands.`;
  if (ask.kind === "question")
    return `If CONTEXT.md settles it, answer ${ask.id}; else ask the Human with your recommendation, write their answer into CONTEXT.md, then answer. The Lead runs on its default meanwhile.`;
  return `Decide and answer ${ask.id}; a kit or setup error goes to the Human word for word.`;
}

/** What the Human's word asks of whoever put the question: only a choice unlike what went ahead meanwhile turns anything round. */
function answeredNext(question: Question): string {
  if (question.status === "declined") return "The call is yours now: decide it and carry that where it applies";
  if (question.class === "irreversible")
    return "Carry their choice into the lane, and write it into CONTEXT.md if it settles the concept";
  if (question.answer?.choice !== question.recommend)
    return "Turn round what went ahead on your recommendation, and write their choice into CONTEXT.md if it settles the concept";
  return "Write their choice into CONTEXT.md if it settles the concept";
}

/** The letters an ask sends: to whoever it is put to, the answer back, and the reminders while it waits. */
export const askLetters = {
  askTo(ask: Ask, from: string, reader: "lead" | "supervisor"): Letter {
    const next =
      reader === "lead"
        ? `Answer ${ask.id} from the brief and the code; if only the owner can, ask up and tell the Peer to wait.`
        : askNext(ask);
    return mail(
      "ask",
      [ask.id],
      [`ASK ${ask.id} (${ask.kind}) from ${from}`, "", ask.text, ...theirDefault(ask)].join("\n"),
      next,
    );
  },

  /** Whoever asked the Human is told their word from the panel, and that a lane held for it stays held until it is resumed. */
  humanAnswered(question: Question, lane: Lane | undefined): Letter {
    const word = question.status === "declined" ? "they declined to decide it" : (question.answer?.choice ?? "");
    const lines = [`HUMAN ANSWERED ${question.id} (${firstLine(question.question)}), on the panel: ${word}.`];
    if (question.answer?.text) lines.push("", "Their note, their own words:", question.answer.text);
    if (lane?.onHold) lines.push("", `Lane ${lane.id} is still on hold for it.`);
    const next = answeredNext(question);
    return mail(
      "humananswered",
      [question.id],
      lines.join("\n"),
      lane?.onHold ? `${next}; then resume_lane ${lane.id}.` : `${next}.`,
    );
  },

  answered(ask: Ask): Letter {
    return mail(
      "answer",
      [ask.id],
      [`ANSWER to your ask ${ask.id}`, "", ask.answer ?? ""].join("\n"),
      "Go on with your work from it.",
    );
  },

  /** The seat an ask was put to, told what its asker was told and by whom: the owner may answer a Lead's ask, never out of its sight. */
  answeredFor(ask: Ask, by: string, leads = true): Letter {
    const text = [
      `ANSWERED FOR YOU: ${ask.id} (${ask.kind}) from ${ask.from}, which was waiting on you, was answered by ${by}.`,
      "",
      "The question:",
      ask.text,
      "",
      "The answer it was given:",
      ask.answer ?? "",
      "",
      // Only an ask with a task has a Peer to speak of, and acceptance is only a Lead's to judge.
      ask.task && leads
        ? `Nothing else moved: ${ask.task} is still owned by the same Peer, on the same branch, and accepting it is still yours to judge.`
        : "Nothing else moved.",
    ].join("\n");
    return mail(
      "answeredFor",
      [ask.id],
      text,
      leads
        ? "If this changes what you were going to do, say so in your next report."
        : "If it changes a decision of yours, carry that into the lane.",
    );
  },

  reminder(ask: Ask, minutes: number): Letter {
    return mail(
      "remind",
      [ask.id, ask.reminders],
      `STILL OPEN after ${minutes} minutes: ask ${ask.id} (${ask.kind}): ${firstLine(ask.text)}`,
      "Answer it now: whoever asked is waiting on you.",
    );
  },

  escalated(ask: Ask, minutes: number, lane: string): Letter {
    const text = [
      `UNANSWERED ${ask.id} in ${lane}: a Peer has waited ${minutes} minutes on its Lead.`,
      "",
      ask.text,
      ...theirDefault(ask),
    ].join("\n");
    return mail(
      "escalate",
      [ask.id],
      text,
      "Take the smallest step that unblocks the Peer, often answering it yourself (its Lead is told); if the Lead looks stuck, read its record first.",
    );
  },
};
