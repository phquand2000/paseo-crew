import type { Question } from "../../../catalog/kit.ts";
import type { Fact } from "../facts.ts";
import { type Finding, type Verdict, rank } from "../findings.ts";

export function confirmable(questions: Record<string, Question>): Set<string> {
  return new Set(Object.values(questions).flatMap((question) => (question.threshold === undefined ? [] : (question.confirms ?? []))));
}

export type Reading = { unclear: number; ended: boolean; before?: Record<string, number> };

export function weigh(assessment: { answers: Record<string, number>; model: string }, questions: Record<string, Question>, noted: Fact[], reading: Reading): { findings: Finding[]; verdicts: Verdict[] } {
  const { unclear, ended, before } = reading;
  const findings: Finding[] = [];
  const verdicts: Verdict[] = [];
  for (const [name, question] of Object.entries(questions)) {
    const p = assessment.answers[name];
    const threshold = question.threshold;
    if (p === undefined || threshold === undefined) continue;
    const passes = p >= threshold;
    const doubtful = !passes && p >= Math.round((threshold - unclear) * 1e9) / 1e9;
    for (const kind of new Set(noted.filter((fact) => question.confirms?.includes(fact.kind)).map((fact) => fact.kind))) {
      verdicts.push({ kind, question: name, p, model: assessment.model, says: passes ? "confirms" : doubtful ? "unclear" : "vetoes" });
    }
    if (!question.level) continue;
    let level = question.level;
    if (question.alone && level === "page") {
      if (!passes && !doubtful) continue;
      if (doubtful) level = "attend";
    } else if (question.alone) {
      const again = before?.[name];
      if (!passes || (!ended && (again === undefined || again < threshold))) continue;
    } else if (!passes) continue;
    const agreeing = question.alone ? [] : noted.filter((fact) => question.agrees?.includes(fact.kind));
    if (!question.alone && agreeing.length === 0) continue;
    const because = agreeing.map((fact) => `${fact.kind}: ${fact.quote}`).join("; ");
    findings.push({ kind: name, level, quote: because ? `${question.instructions} — ${because}` : question.instructions, facts: [...new Set(agreeing.map((fact) => fact.kind))], p, model: assessment.model });
  }
  return { findings: findings.sort((a, b) => rank(a) - rank(b)), verdicts };
}
