import type { CheckSpec } from "../catalog/kit.ts";
import { errorText } from "../core/errors.ts";
import type { Answer, Judge, Question } from "../core/ports.ts";
import type { Project } from "./project.ts";
import { appendRecord } from "./records.ts";
import type { DeskServices } from "./services.ts";

/**
 * One moment of the record the watch asks about: whose it is (`subject`), which of theirs (`episode`), the state the
 * questions read, and each question by the name it is asked under, with the check it comes from and the fields the code fills.
 */
export type Case = {
  subject: string;
  episode: string;
  state: Record<string, unknown>;
  asked: Record<string, { check: string; fill?: Record<string, string> }>;
};

/** Who answers for `project` now, if anyone can: a sensor needs its key and the host a way to ask it; a seat is the project's Watcher. */
function judgeFor(
  { ctx, watcher }: DeskServices,
  project: Project,
  subject: string,
): { id: string; judge: Judge } | undefined {
  const choice = ctx.team(project).judge;
  if (!choice) return undefined;
  if ("role" in choice) return { id: choice.id, judge: watcher.judge(project, choice.role, subject) };
  const judge = choice.key ? ctx.sensor(choice.sensor, choice.key) : undefined;
  return judge && { id: choice.id, judge };
}

/** The check's wording with the fields the code fills; one left unfilled is the code's mistake, and nothing is asked. */
function questionOf(check: CheckSpec, fill: Record<string, string> = {}): Question {
  const { instructions } = check;
  if (typeof instructions === "string") return { type: check.type, instructions, criteria: check.criteria };
  const filled = Object.fromEntries(
    Object.entries(instructions).map(([field, value]) => [field, value ?? fill[field]]),
  );
  const missing = Object.keys(filled).filter((field) => filled[field] === undefined);
  if (missing.length > 0) throw new Error(`nothing filled ${missing.join(", ")} in ${JSON.stringify(instructions)}`);
  return { type: check.type, instructions: filled as Record<string, string>, criteria: check.criteria };
}

/** Where an answer falls: a noul on its check's thresholds, a choice as picked where it is sure enough. */
function verdictOf(check: CheckSpec, answer: Answer): string {
  if (check.type === "choice") return "choice" in answer && answer.confidence >= check.sure ? answer.choice : "unclear";
  const yes = "noul" in answer ? answer.noul : undefined;
  return yes === undefined ? "unclear" : yes >= check.yes ? "yes" : yes <= check.no ? "no" : "unclear";
}

/**
 * Asks whoever answers for the project about one case, and keeps what came back in its assessments, a failure included:
 * in shadow that record is all an answer does. Nothing the desk does waits on it, so it never throws.
 */
export async function judge(services: DeskServices, project: Project, found: Case): Promise<void> {
  const { ctx } = services;
  const asked = Object.entries(found.asked).filter(([, { check }]) => ctx.kit.checks[check]?.mode === "shadow");
  const chosen = asked.length > 0 ? judgeFor(services, project, found.subject) : undefined;
  if (!chosen) return;
  const kept = {
    at: new Date().toISOString(),
    subject: found.subject,
    episode: found.episode,
    by: chosen.id,
    state: found.state,
    checks: Object.fromEntries(asked.map(([name, { check }]) => [name, check])),
  };
  try {
    const questions = Object.fromEntries(
      asked.map(([name, { check, fill }]) => [name, questionOf(ctx.kit.checks[check]!, fill)]),
    );
    const judged = await chosen.judge.ask(found.state, questions);
    const verdicts = Object.fromEntries(
      asked.map(([name, { check }]) => [name, verdictOf(ctx.kit.checks[check]!, judged.answers[name]!)]),
    );
    appendRecord(
      project.state,
      "assessments",
      `${JSON.stringify({ ...kept, questions, model: judged.model, tokens: judged.tokens, answers: judged.answers, why: judged.why, verdicts })}\n`,
    );
  } catch (error) {
    appendRecord(project.state, "assessments", `${JSON.stringify({ ...kept, unasked: errorText(error) })}\n`);
    ctx.event(project, { kind: "watch.unasked", subject: found.subject, by: chosen.id, error: errorText(error) });
  }
}
