import type { Question } from "../../domain/question.ts";
import type { Ask } from "../../domain/ask.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Letter, firstLine, fyi, mail, quoted, say } from "./envelope.ts";

const theirDefault = (ask: Ask): string[] =>
  ask.default ? ["", `Until it is answered, they go with: ${ask.default}`] : [];
const asker = (ask: Ask) => (ask.task ? `the engineer on ${ask.task}` : ask.from);

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

/** The letters an ask sends: to whoever it is put to, and the answer back. */
export const askLetters = {
  askTo(ask: Ask, from: string, reader: "lead" | "supervisor", carried: Ask[] = []): Letter {
    const then =
      reader === "lead"
        ? `Answer ${ask.id} from the brief and the code; if only the owner can, ask up with carries [${ask.id}] and leave it open: its engineer waits on it without being nudged.`
        : askNext(ask);
    const carries = carried.map(
      (entry) => `It carries ${entry.id}: the engineer on ${entry.task} waits on this answer.`,
    );
    return say(
      "ask",
      [ask.id],
      [
        `${from[0]!.toUpperCase()}${from.slice(1)} asks ${ask.id} (${ask.kind}):`,
        "",
        ask.text,
        ...theirDefault(ask),
        ...(carries.length ? ["", ...carries] : []),
        "",
        then,
      ].join("\n"),
    );
  },

  /** A Peer told its ask went up, so a turn that wakes before the answer does not ask it again. */
  carried(ask: Ask, up: string): Letter {
    return fyi(
      say(
        "carried",
        [ask.id, up],
        `I've put your ask ${ask.id} to the owner as ${up}; their answer reaches you as the answer to ${ask.id}. Until it comes, keep to your default and stop here.`,
      ),
    );
  },

  /** Whoever asked the Human is told their word from the panel, and that a lane held for it stays held until it is resumed. */
  humanAnswered(question: Question, lane: Lane | undefined, carried: string[] = []): Letter {
    const word = question.status === "declined" ? "they declined to decide it" : (question.answer?.choice ?? "");
    const lines = [`The Human answered ${question.id} (${firstLine(question.question)}) on the panel: ${word}.`];
    if (question.answer?.text) lines.push("", "Their note, their own words:", question.answer.text);
    if (lane?.onHold) lines.push("", `Lane ${lane.id} is still on hold for it.`);
    const then = answeredNext(question) + (carried.length ? `; answer ${carried.join(", ")}, which it carries` : "");
    lines.push("", lane?.onHold ? `${then}; then resume_lane ${lane.id}.` : `${then}.`);
    return say("humananswered", [question.id], lines.join("\n"));
  },

  /** `leads`: the asker splits work into tasks, so an answer that changes what one must show is carried into it. */
  answered(ask: Ask, carried: string[] = [], leads = false): Letter {
    const names = carried.join(", ");
    const amend = leads ? "amend_task any task whose acceptance it changes, " : "";
    const then = carried.length
      ? [`It carries ${names}: answer ${names} for its engineer from it, ${amend}then go on with your work.`]
      : leads
        ? [`From it, ${amend}then go on with your work.`]
        : [];
    return say(
      "answer",
      [ask.id],
      [`On your ask ${ask.id}:`, "", ask.answer ?? "", ...then.flatMap((line) => ["", line])].join("\n"),
    );
  },

  /** The seat an ask was put to, told what its asker was told and by whom: the owner may answer a Lead's ask, never out of its sight. `waited` false: a Peer's ask put to the owner while the lane had no Lead, told to the Lead it has now. */
  answeredFor(ask: Ask, by: string, leads = true, waited = true): Letter {
    const who = by === "the owner" ? "I" : `${by[0]!.toUpperCase()}${by.slice(1)}`;
    const opening = waited
      ? `${who} answered ${ask.id} for you, the ${ask.kind} ${asker(ask)} put to you.`
      : `While your lane had no Lead, ${asker(ask)} put ${ask.id} (${ask.kind}) to me, and I answered it.`;
    const text = [
      opening,
      "",
      quoted(ask.text),
      "",
      `The answer:`,
      "",
      quoted(ask.answer ?? ""),
      "",
      // Only an ask with a task has an engineer to speak of, and acceptance is only a Lead's to judge.
      (ask.task && leads
        ? `Nothing else moved: ${ask.task} is still the same engineer's, on the same branch, and accepting it is still yours to judge. `
        : "Nothing else moved. ") +
        (leads
          ? "If this changes what you were going to do, say so in your next report."
          : "If it changes a decision of yours, carry that into the lane."),
    ].join("\n");
    return say("answeredFor", [ask.id], text);
  },

  /** Whoever supervises sees a Peer's default overruled by its Lead, without being woken for it. */
  /** A decision that cannot be undone waits for the Human: the Lead keeps off what it decides and plans the rest around it. */
  pending(question: Question): Letter {
    return mail(
      "pending",
      [question.id],
      `DECISION PENDING ${question.id}, the Human's to make: ${firstLine(question.question)}\n\nNothing it decides goes ahead until they answer; what it does not touch goes on.`,
      "Keep the lane off what it decides, and carry on with the rest; the Supervisor carries their answer into the lane.",
    );
  },

  overruled(ask: Ask): Letter {
    const text = [
      `The Lead answered ${ask.id} (${ask.kind}) on ${ask.task ?? ask.lane ?? "the project"} against the ${ask.fromRole}'s default:`,
      "",
      quoted(ask.text),
      ...(ask.default ? ["", `Their default was: ${ask.default}`] : []),
      "",
      "The answer:",
      "",
      quoted(ask.answer ?? ""),
      "",
      "Nothing to do, unless the answer crosses the lane's intent or the Lead keeps overruling.",
    ].join("\n");
    return fyi(say("overruled", [ask.id], text));
  },
};
