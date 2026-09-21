import type { Fact } from "./facts.ts";

export type Finding = {
  kind: string;
  level: "page" | "attend";
  quote: string;
  facts: string[];
  p?: number;
  model?: string;
  /** Set when a Watcher raised it rather than the code or Jev. */
  by?: "watcher";
};

export type Verdict = { kind: string; question: string; p: number; model: string; says: "confirms" | "vetoes" | "unclear"; why?: string };

const FIRST = ["destructive", "unsafe_action", "stuck", "no-recovery", "long-turn", "goal_drift"];

export const rank = (finding: Finding) => (finding.level === "page" ? 0 : 1) * 100 + (FIRST.includes(finding.kind) ? FIRST.indexOf(finding.kind) : FIRST.length);

export function decide(facts: Fact[]): Finding[] {
  return facts.flatMap((fact) => (fact.level === "note" ? [] : [{ kind: fact.kind, level: fact.level, quote: fact.quote, facts: [fact.kind] }])).sort((a, b) => rank(a) - rank(b));
}
