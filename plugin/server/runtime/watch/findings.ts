import type { Finding } from "../../domain/incident.ts";
import type { Fact } from "./facts.ts";

const FIRST = ["destructive", "stuck", "no-recovery", "long-turn"];

const rank = (finding: Finding) =>
  (finding.level === "page" ? 0 : 1) * 100 +
  (FIRST.includes(finding.kind) ? FIRST.indexOf(finding.kind) : FIRST.length);

export function decide(facts: Fact[]): Finding[] {
  return facts
    .flatMap((fact) =>
      fact.level === "note" ? [] : [{ kind: fact.kind, level: fact.level, quote: fact.quote, facts: [fact.kind] }],
    )
    .sort((a, b) => rank(a) - rank(b));
}
