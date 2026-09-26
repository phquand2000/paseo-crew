import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Question, QuestionClass } from "../../domain/question.ts";
import { coverGlob, firstOverlap } from "../../core/scope.ts";
import { clip } from "../../core/text.ts";
import { no, ok, str } from "../context.ts";
import { putOnHold } from "../hold.ts";
import { askFirstHits, changeOf } from "../landing.ts";
import { type Lane, findLane, loadLedger, nextQuestionId } from "../ledger.ts";
import { type Project, loadConfig } from "../project.ts";
import { defineTool } from "../services.ts";

const DAY_MS = 24 * 3_600_000;

const WHILE_SILENT: Record<QuestionClass, string> = {
  reversible: "Nothing waits for it: the lane goes on as you said it would if they are silent, and they can overturn that.",
  costly: "The lane goes on as you said it would if they are silent, and stops at its next report of ready if they have not answered by then.",
  irreversible: "Nothing it decides goes ahead until they answer.",
};

/** The questions put to the Human since `since` across every project on this machine: the Human has one attention for them all. */
function askedSince(state: string, since: number): Question[] {
  const projects = dirname(state);
  return readdirSync(projects).flatMap((slug) => {
    try {
      return Object.values(loadLedger(join(projects, slug)).questions).filter((question) => question.openedAt >= since);
    } catch {
      return [];
    }
  });
}

/** Why a question about `lane` stops it at its ready report at least: it writes where the Human asked to be asked first, by its write set or its work. */
async function askFirstOf(project: Project, lane: Lane): Promise<string | undefined> {
  const declared = loadConfig(project.state).askFirst.find((path) => firstOverlap(lane.writeSet, [coverGlob(path)]));
  if (declared) return `Lane ${lane.id} may write under ${declared}, which the Human asked to be asked about first.`;
  const hit = lane.status === "open" ? askFirstHits(project, await changeOf(project, lane))[0] : undefined;
  return hit && `Lane ${lane.id}: ${hit}`;
}

/** Puts a decision only the Human can make on their question queue, with what happens while they are silent. */
export const askHuman = defineTool({
  name: "ask_human",
  input: z.strictObject({
    question: z.string(),
    why: z.string(),
    lane: z.string().optional(),
    options: z.array(z.strictObject({ label: z.string().max(60), effect: z.string() })).min(2).max(4),
    recommend: z.string(),
    reason: z.string(),
    ifSilent: z.string(),
    class: z.enum(["reversible", "costly", "irreversible"]),
  }),
  async handle(desk, caller, args) {
    const { ctx } = desk;
    const { project } = caller;
    const labels = args.options.map((option) => option.label.trim());
    if (new Set(labels.map((label) => label.toLowerCase())).size < labels.length || labels.some((label) => ["decline", "cancel"].includes(label.toLowerCase()))) {
      return no("Give each option a label of its own, and none called decline or cancel: those are the Human's to say without an option.");
    }
    if (!labels.includes(args.recommend.trim())) return no(`recommend names none of the options: give one of ${labels.join(", ")}.`);
    const budget = ctx.team(project).attention.questionsPerDay;
    const asked = askedSince(project.state, Date.now() - DAY_MS);
    if (asked.length >= budget) {
      return no(`The Human has had ${asked.length} questions in the last day (${asked.map((question) => question.id).join(", ")}), and ${budget} is what they allow: decide this yourself if it is yours to, fold it into one still open, or ask it once the day turns.`);
    }
    const named = args.lane ? findLane(loadLedger(project.state), args.lane) : undefined;
    // The Supervisor may only raise a question's class above what the Human's standing orders make it.
    const floor = named && named.status !== "closed" && args.class === "reversible" ? await askFirstOf(project, named) : undefined;
    const kind: QuestionClass = floor ? "costly" : args.class;
    const opened = ctx.transact(project, (ledger) => {
      const lane = args.lane ? findLane(ledger, args.lane) : undefined;
      if (args.lane && (!lane || lane.status === "closed")) return `There is no open or waiting lane ${str(args.lane)}.`;
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
        // A costly question stops its lane at the ready report; asked once the lane has reported ready, that is now.
        parked: (lane !== undefined && (kind === "irreversible" || (kind === "costly" && lane.ready !== undefined))) || undefined,
      };
      ledger.questions[question.id] = question;
      return question;
    });
    if (typeof opened === "string") return no(opened);
    ctx.event(project, { kind: "question.asked", question: opened.id, lane: opened.lane ?? null, class: opened.class });
    const parked = opened.parked ? await putOnHold(desk, project, opened.lane!, caller.id, `it waits for the Human's answer to ${opened.id}: ${clip(opened.question, 200)}`) : undefined;
    const held = parked === undefined ? "" : typeof parked === "string" ? ` Its lane was not put on hold: ${parked}` : ` Lane ${opened.lane} is on hold for it.`;
    const raised = floor ? ` It is costly, not reversible. ${floor}` : "";
    const silent = opened.class === "costly" && opened.parked ? "Its lane has already reported ready, so it stops now until they answer." : WHILE_SILENT[opened.class];
    return ok(`Asked the Human as ${opened.id}; it waits in their question queue.${raised} ${silent}${held} An answer they give you here goes on record with record_human_answer.`);
  },
});
