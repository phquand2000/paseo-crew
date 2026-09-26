import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Question, QUESTION } from "../domain/question.ts";
import type { DeskContext } from "./context.ts";
import { loadLedger } from "./ledger.ts";
import type { Project } from "./project.ts";

/** The questions put to the Human since `since` across every project on this machine: the Human has one attention for them all. */
export function askedSince(state: string, since: number): Question[] {
  const projects = dirname(state);
  return readdirSync(projects).flatMap((slug) => {
    try {
      return Object.values(loadLedger(join(projects, slug)).questions).filter((question) => question.openedAt >= since);
    } catch {
      return [];
    }
  });
}

/** The Human's word on question `id`, from the chat or the panel: one of its options, or decline, or cancel. What the record holds now, or why not. */
export function settleQuestion(
  ctx: DeskContext,
  project: Project,
  id: string,
  choice: string,
  given: { text?: string; by: "panel" | "chat"; quote?: string },
): Question | string {
  const move = choice.toLowerCase() === "decline" ? "decline" : choice.toLowerCase() === "cancel" ? "cancel" : "answer";
  const recorded = ctx.transact(project, (ledger) => {
    const question = ledger.questions[id];
    if (!question) return `There is no question ${id}.`;
    if (move === "answer" && !question.options.some((option) => option.label === choice))
      return `${choice} is none of ${id}'s options: ${question.options.map((option) => option.label).join(", ")}, or decline or cancel.`;
    if (!QUESTION.move(question, move)) return `${id} is already ${question.status}.`;
    question.answer = { choice, ...given, at: Date.now() };
    return { ...question };
  });
  if (typeof recorded !== "string")
    ctx.event(project, { kind: "question.answered", question: id, status: recorded.status, by: given.by });
  return recorded;
}
