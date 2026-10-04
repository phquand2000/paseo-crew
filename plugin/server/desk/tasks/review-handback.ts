import { plural } from "../../core/text.ts";
import { type Ledger, tasksOf } from "../../domain/ledger.ts";
import type { ReviewFinding, Task } from "../../domain/task.ts";

/** A review's verdict as the done tool takes it. */
export type Verdict = {
  verdict?: string;
  answer?: string;
  answers?: string[];
  findings?: ReviewFinding[];
  read?: string[];
  ran?: string[];
};

const BLOCKING: readonly string[] = ["P0", "P1"];

/** Why a review's verdict is refused before anything is written: a risk rule unanswered, or a block that rests on no evidence. */
export function verdictRefusal(task: Task, args: Verdict): string | undefined {
  const asked = task.asked ?? [];
  if (asked.some((_, index) => !args.answers?.[index]?.trim())) {
    const count = plural(asked.length, "a question", `${asked.length} questions`);
    const list = asked.map((question, index) => `${index + 1}. ${question}`).join("\n");
    return `The project's risk rules ask this review ${count}; give answers, one per question, in this order:\n${list}`;
  }
  const findings = args.findings ?? [];
  const unconfirmed = findings.filter((found) => BLOCKING.includes(found.severity) && !found.confirmedBy?.trim());
  if (unconfirmed.length > 0)
    return `A P0 or P1 finding sends work back, so it says in confirmedBy how it was reproduced: a failing test, a command and what it printed, or a file:line trace. Give that for ${unconfirmed.map(named).join("; ")}, or rate it P2, which goes to the lane's backlog.`;
  const ofChange = task.of !== undefined || task.scope === "lane";
  if (ofChange && args.verdict === "changes" && !findings.some((found) => BLOCKING.includes(found.severity)))
    return "A changes verdict sends work back, so it rests on a P0 or P1 finding. With none, the verdict is accept, and P2 and P3 findings go to the lane's backlog.";
  return undefined;
}

const named = (found: ReviewFinding): string => `${found.severity} ${found.where ?? found.failure}`;

type Reviewed = Task & { handback: NonNullable<Task["handback"]> };

/** What a review is of: the whole lane, a task, or neither for an open question; `id` is left out of what came before. */
export type Same = Pick<Task, "id" | "lane" | "scope" | "of">;

/** The reviews of the same change handed back before, oldest first: of the whole lane for a lane review, else of the same task. */
export function earlierReviews(ledger: Ledger, review: Same): Reviewed[] {
  if (review.scope !== "lane" && !review.of) return [];
  const same = (entry: Task) => (review.scope === "lane" ? entry.scope === "lane" : entry.of === review.of);
  return tasksOf(ledger, review.lane)
    .filter(
      (entry): entry is Reviewed =>
        entry.id !== review.id && entry.kind === "review" && same(entry) && entry.handback !== undefined,
    )
    .sort((a, b) => a.handback.at - b.handback.at);
}

/** Reviews of the same change that ended in changes, this one included: by lane for the whole lane, by target for a task, so a new fix task does not reset it. */
export function roundsOf(ledger: Ledger, task: Task, outcome: string): number {
  if (task.kind !== "review" || outcome !== "changes") return 0;
  return earlierReviews(ledger, task).filter((entry) => entry.handback.outcome === "changes").length + 1;
}

/** The earlier reviews of the same change and how each ended, so a round is seen as one; none before the first. */
export function roundsLine(ledger: Ledger, review: Same): string | undefined {
  const earlier = earlierReviews(ledger, review);
  if (earlier.length === 0) return undefined;
  const what = review.scope === "lane" ? "the whole lane" : review.of;
  return `Reviews of ${what} before this one: ${earlier.map((entry) => `${entry.id} ${entry.handback.outcome}`).join(", ")}.`;
}

export function reviewBody(task: Task, args: Verdict): { outcome: string; body: string } {
  const outcome = args.verdict?.trim() ?? "";
  const confirmed = (found: ReviewFinding) => (found.confirmedBy ? ` Confirmed by: ${found.confirmedBy}` : "");
  const findings = (args.findings ?? []).map(
    (found) =>
      `- ${found.severity} ${found.where ? `${found.where}: ` : ""}${found.failure} Fix: ${found.fix}${confirmed(found)}`,
  );
  const answers = listOf(args.answers);
  const asked = (task.asked ?? []).flatMap((question, index) => [`${index + 1}. ${question}`, `   ${answers[index]}`]);
  const lines = [
    `Verdict: ${outcome}`,
    "",
    args.answer?.trim() ?? "",
    "",
    "Findings:",
    ...(findings.length > 0 ? findings : ["none"]),
    ...(asked.length > 0 ? ["", "Asked by the project's risk rules:", ...asked] : []),
    "",
    `Read: ${listOf(args.read).join("; ") || "not given"}`,
    `Ran: ${listOf(args.ran).join("; ") || "nothing"}`,
  ];
  return { outcome, body: lines.join("\n") };
}

const listOf = (items: string[] | undefined): string[] => (items ?? []).map((item) => item.trim()).filter(Boolean);
