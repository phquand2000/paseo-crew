import type { Question } from "../../domain/question.ts";
import type { Ask } from "../../domain/ask.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Letter, firstLine, fyi, mail } from "./envelope.ts";

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

/** The letters an ask sends: to whoever it is put to, and the answer back. */
export const askLetters = {
  askTo(ask: Ask, from: string, reader: "lead" | "supervisor", carried: Ask[] = []): Letter {
    const next =
      reader === "lead"
        ? `Answer ${ask.id} from the brief and the code; if only the owner can, ask up with carries [${ask.id}] and leave it open: its Peer waits on it without being nudged.`
        : askNext(ask);
    const carries = carried.map((entry) => `Carries ${entry.id}: the Peer on ${entry.task} waits on this answer.`);
    return mail(
      "ask",
      [ask.id],
      [
        `ASK ${ask.id} (${ask.kind}) from ${from}`,
        "",
        ask.text,
        ...theirDefault(ask),
        ...(carries.length ? ["", ...carries] : []),
      ].join("\n"),
      next,
    );
  },

  /** A Peer told its ask went up, so a turn that wakes before the answer does not ask it again. */
  carried(ask: Ask, up: string): Letter {
    return fyi(
      mail(
        "carried",
        [ask.id, up],
        `CARRIED UP ${ask.id}: your Lead put it to the owner as ${up}. Its answer reaches you as the answer to ${ask.id}.`,
        "Nothing until it comes: keep to your default, and stop here.",
      ),
    );
  },

  /** Whoever asked the Human is told their word from the panel, and that a lane held for it stays held until it is resumed. */
  humanAnswered(question: Question, lane: Lane | undefined, carried: string[] = []): Letter {
    const word = question.status === "declined" ? "they declined to decide it" : (question.answer?.choice ?? "");
    const lines = [`HUMAN ANSWERED ${question.id} (${firstLine(question.question)}), on the panel: ${word}.`];
    if (question.answer?.text) lines.push("", "Their note, their own words:", question.answer.text);
    if (lane?.onHold) lines.push("", `Lane ${lane.id} is still on hold for it.`);
    const next = answeredNext(question) + (carried.length ? `; answer ${carried.join(", ")}, which it carries` : "");
    return mail(
      "humananswered",
      [question.id],
      lines.join("\n"),
      lane?.onHold ? `${next}; then resume_lane ${lane.id}.` : `${next}.`,
    );
  },

  /** `leads`: the asker splits work into tasks, so an answer that changes what one must show is carried into it. */
  answered(ask: Ask, carried: string[] = [], leads = false): Letter {
    const names = carried.join(", ");
    const amend = leads ? "amend_task any task whose acceptance it changes, " : "";
    return mail(
      "answer",
      [ask.id],
      [`ANSWER to your ask ${ask.id}`, "", ask.answer ?? ""].join("\n"),
      carried.length
        ? `It carries ${names}: answer ${names} for its Peer from it, ${amend}then go on with your work.`
        : leads
          ? `From it, ${amend}then go on with your work.`
          : "Go on with your work from it.",
    );
  },

  /** The seat an ask was put to, told what its asker was told and by whom: the owner may answer a Lead's ask, never out of its sight. `waited` false: a Peer's ask put to the owner while the lane had no Lead, told to the Lead it has now. */
  answeredFor(ask: Ask, by: string, leads = true, waited = true): Letter {
    const put = waited ? "which was waiting on you" : "put to the owner while your lane had no Lead";
    const text = [
      `ANSWERED FOR YOU: ${ask.id} (${ask.kind}) from ${ask.from}, ${put}, was answered by ${by}.`,
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
      `OVERRULED ${ask.id} (${ask.kind}) on ${ask.task ?? ask.lane ?? "the project"}: the Lead answered the ${ask.fromRole} against its default.`,
      "",
      ask.text,
      ...theirDefault(ask),
      "",
      "The answer:",
      ask.answer ?? "",
    ].join("\n");
    return fyi(
      mail(
        "overruled",
        [ask.id],
        text,
        "Nothing, unless the answer crosses the lane's intent or the Lead keeps overruling.",
      ),
    );
  },
};
