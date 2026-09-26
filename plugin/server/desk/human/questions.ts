import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { coverGlob, firstOverlap } from "../../core/scope.ts";
import { sentBy } from "../../core/sent-by.ts";
import { clip } from "../../core/text.ts";
import { DAY_MS } from "../../core/time.ts";
import { QUESTION, type Question, type QuestionClass } from "../../domain/question.ts";
import type { DeskBase } from "../base.ts";
import { type Caller, type ToolReply, no, ok, str } from "../context.ts";
import { putOnHold } from "../lanes/hold.ts";
import { askFirstHits, changeOf } from "../lanes/land-facts.ts";
import type { Lane } from "../../domain/lane.ts";
import { findLane, nextQuestionId } from "../../domain/ledger.ts";
import { loadLedger, readLedger } from "../store/ledger.ts";
import { type Project, loadConfig } from "../project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";

/** An ask_human call as the tool takes it. */
type AskHumanCall = {
  question: string;
  why: string;
  lane?: string;
  options: { label: string; effect: string }[];
  recommend: string;
  reason: string;
  ifSilent: string;
  class: QuestionClass;
};

const WHILE_SILENT: Record<QuestionClass, string> = {
  reversible:
    "Nothing waits for it: the lane goes on as you said it would if they are silent, and they can overturn that.",
  costly:
    "The lane goes on as you said it would if they are silent, and stops at its next report of ready if they have not answered by then.",
  irreversible: "Nothing it decides goes ahead until they answer.",
};

/** Puts a decision only the Human can make on their question queue, with what happens while they are silent. */
export async function askHuman(desk: DeskServices, caller: Caller, args: AskHumanCall): Promise<ToolReply> {
  const { project } = caller;
  const invalid = optionsProblem(args) ?? overBudget(desk, project);
  if (invalid) return no(invalid);
  const named = args.lane ? findLane(loadLedger(project.state), args.lane) : undefined;
  // The Supervisor may only raise a question's class above what the Human's standing orders make it.
  const floor =
    named && named.status !== "closed" && args.class === "reversible" ? await askFirstOf(project, named) : undefined;
  const opened = recordQuestion(desk, caller, args, floor ? "costly" : args.class);
  if (typeof opened === "string") return no(opened);
  recordEvent(project, { kind: "question.asked", question: opened.id, lane: opened.lane ?? null, class: opened.class });
  const why = `it waits for the Human's answer to ${opened.id}: ${clip(opened.question, 200)}`;
  const parked = opened.parked ? await putOnHold(desk, project, opened.lane!, caller.id, why) : undefined;
  const held =
    parked === undefined
      ? ""
      : typeof parked === "string"
        ? ` Its lane was not put on hold: ${parked}`
        : ` Lane ${opened.lane} is on hold for it.`;
  const raised = floor ? ` It is costly, not reversible. ${floor}` : "";
  const silent =
    opened.class === "costly" && opened.parked
      ? "Its lane has already reported ready, so it stops now until they answer."
      : WHILE_SILENT[opened.class];
  return ok(
    `Asked the Human as ${opened.id}; it waits in their question queue.${raised} ${silent}${held} An answer they give you here goes on record with record_human_answer.`,
  );
}

function optionsProblem(args: AskHumanCall): string | undefined {
  const labels = args.options.map((option) => option.label.trim());
  const reserved = labels.some((label) => ["decline", "cancel"].includes(label.toLowerCase()));
  if (new Set(labels.map((label) => label.toLowerCase())).size < labels.length || reserved)
    return "Give each option a label of its own, and none called decline or cancel: those are the Human's to say without an option.";
  if (!labels.includes(args.recommend.trim()))
    return `recommend names none of the options: give one of ${labels.join(", ")}.`;
  return undefined;
}

function overBudget({ teamFor }: Pick<DeskServices, "teamFor">, project: Project): string | undefined {
  const budget = teamFor(project).attention.questionsPerDay;
  const asked = askedSince(project.state, Date.now() - DAY_MS);
  if (asked.length < budget) return undefined;
  const ids = asked.map((question) => question.id).join(", ");
  return `The Human has had ${asked.length} questions in the last day (${ids}), and ${budget} is what they allow: decide this yourself if it is yours to, fold it into one still open, or ask it once the day turns.`;
}

function recordQuestion(
  { ledgers }: Pick<DeskServices, "ledgers">,
  caller: Caller,
  args: AskHumanCall,
  kind: QuestionClass,
): Question | string {
  return ledgers.transact(caller.project, (ledger) => {
    const lane = args.lane ? findLane(ledger, args.lane) : undefined;
    if (args.lane && (!lane || lane.status === "closed")) return `There is no open or waiting lane ${str(args.lane)}.`;
    // A costly question stops its lane at the ready report; asked once the lane has reported ready, that is now.
    const parked = lane !== undefined && (kind === "irreversible" || (kind === "costly" && lane.ready !== undefined));
    const question: Question = {
      id: nextQuestionId(ledger),
      from: caller.id,
      lane: lane?.id,
      question: str(args.question),
      why: str(args.why),
      options: args.options.map((option) => ({ label: option.label.trim(), effect: str(option.effect) })),
      recommend: args.recommend.trim(),
      reason: str(args.reason),
      ifSilent: str(args.ifSilent),
      class: kind,
      status: "open",
      openedAt: Date.now(),
      parked: parked || undefined,
    };
    ledger.questions[question.id] = question;
    return question;
  });
}

/** Why a question about `lane` stops it at its ready report at least: it writes where the Human asked to be asked first. */
async function askFirstOf(project: Project, lane: Lane): Promise<string | undefined> {
  const declared = loadConfig(project.state).askFirst.find((path) => firstOverlap(lane.writeSet, [coverGlob(path)]));
  if (declared) return `Lane ${lane.id} may write under ${declared}, which the Human asked to be asked about first.`;
  const hit = lane.status === "open" ? askFirstHits(project, await changeOf(project, lane))[0] : undefined;
  return hit && `Lane ${lane.id}: ${hit}`;
}

/** The questions put to the Human since `since` across every project on this machine: the Human has one attention for them all. */
export function askedSince(state: string, since: number): Question[] {
  const projects = dirname(state);
  return readdirSync(projects).flatMap((slug) => {
    try {
      return Object.values(readLedger(join(projects, slug)).questions).filter((question) => question.openedAt >= since);
    } catch {
      // A project whose ledger cannot be read has no questions to count; the desk refuses to write it elsewhere.
      return [];
    }
  });
}

/** The Human's word on question `id`, from the chat or the panel: an option, decline, or cancel; the record now, or why not. */
export function settleQuestion(
  { ledgers }: Pick<DeskBase, "ledgers">,
  project: Project,
  id: string,
  choice: string,
  given: { text?: string; by: "panel" | "chat"; quote?: string },
): Question | string {
  const move = choice.toLowerCase() === "decline" ? "decline" : choice.toLowerCase() === "cancel" ? "cancel" : "answer";
  const recorded = ledgers.transact(project, (ledger) => {
    const question = ledger.questions[id];
    if (!question) return `There is no question ${id}.`;
    const options = question.options.map((option) => option.label);
    if (move === "answer" && !options.includes(choice))
      return `${choice} is none of ${id}'s options: ${options.join(", ")}, or decline or cancel.`;
    if (!QUESTION.move(question, move)) return `${id} is already ${question.status}.`;
    question.answer = { choice, ...given, at: Date.now() };
    return { ...question };
  });
  if (typeof recorded !== "string")
    recordEvent(project, { kind: "question.answered", question: id, status: recorded.status, by: given.by });
  return recorded;
}

/** Words as a quote is checked: spacing, a closing stop and case do not count. */
const flat = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .toLowerCase();

/** Puts an answer the Human gave in the Supervisor's chat on record, once their own words are found there. */
export async function recordHumanAnswer(
  desk: DeskServices,
  caller: Caller,
  args: { question: string; choice: string; quote: string; text?: string },
): Promise<ToolReply> {
  const { roster } = desk;
  const { project } = caller;
  const id = args.question.trim().toUpperCase();
  const quote = flat(args.quote);
  const said = (await roster.history(caller.id, 200)).flatMap(({ item }) =>
    item.type === "user_message" && sentBy(item)[0] === "person" && typeof item.text === "string"
      ? [flat(item.text)]
      : [],
  );
  if (!quote || !said.some((text) => text.includes(quote))) {
    return no(
      `The Human's own words "${clip(str(args.quote), 200)}" are not in this chat as far back as the desk reads: quote what they wrote exactly, or put it to them with ask_human.`,
    );
  }
  const choice = args.choice.trim();
  const recorded = settleQuestion(desk, project, id, choice, {
    text: str(args.text) || undefined,
    by: "chat",
    quote: str(args.quote),
  });
  if (typeof recorded === "string") return no(recorded);
  const lane = recorded.parked && recorded.lane ? loadLedger(project.state).lanes[recorded.lane] : undefined;
  const held = lane?.onHold
    ? ` Lane ${lane.id} is still on hold for it: resume_lane it once the answer is carried into the lane.`
    : "";
  return ok(`${id} is ${recorded.status}: ${choice}.${held}`);
}
