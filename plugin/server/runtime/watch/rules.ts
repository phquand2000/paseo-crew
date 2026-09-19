import type { Question } from "../../catalog/kit.ts";
import type { Fact } from "./facts.ts";

export type Finding = {
  kind: string;
  level: "page" | "attend";
  quote: string;
  facts: string[];
  p?: number;
  model?: string;
};

const FIRST = ["destructive", "unsafe_action", "needs_human", "stuck", "no-recovery", "worker_stuck", "meaningful_progress", "work_off_track", "goal_drift", "long-turn"];

const rank = (finding: Finding) => (finding.level === "page" ? 0 : 1) * 100 + (FIRST.includes(finding.kind) ? FIRST.indexOf(finding.kind) : FIRST.length);

export function fromFacts(facts: Fact[]): Finding[] {
  return facts.flatMap((fact) => (fact.level === "note" ? [] : [{ kind: fact.kind, level: fact.level, quote: fact.quote, facts: [fact.kind] }]));
}

export function fromAnswers(answers: Record<string, number>, questions: Record<string, Question>, noted: Fact[], model?: string): Finding[] {
  const found: Finding[] = [];
  for (const [name, question] of Object.entries(questions)) {
    const p = answers[name];
    if (p === undefined || question.threshold === undefined || !question.level) continue;
    if (!question.alone && !question.agrees) continue;
    if (question.below ? p > question.threshold : p < question.threshold) continue;
    const agreeing = question.alone ? [] : noted.filter((fact) => question.agrees!.includes(fact.kind));
    if (!question.alone && agreeing.length === 0) continue;
    const because = agreeing.map((fact) => `${fact.kind}: ${fact.quote}`).join("; ");
    found.push({
      kind: name,
      level: question.level,
      quote: because ? `${question.instructions} — p=${p.toFixed(2)}, and ${because}` : `${question.instructions} — p=${p.toFixed(2)}`,
      facts: [...new Set(agreeing.map((fact) => fact.kind))],
      p,
      ...(model ? { model } : {}),
    });
  }
  return found;
}

export function decide(facts: Fact[], assessment?: { answers: Record<string, number>; model: string }, questions: Record<string, Question> = {}, noted: Fact[] = []): Finding[] {
  const found = [...fromFacts(facts), ...(assessment ? fromAnswers(assessment.answers, questions, noted, assessment.model) : [])];
  return found.sort((a, b) => rank(a) - rank(b));
}
