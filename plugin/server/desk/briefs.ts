import { SETTLED } from "../domain/task.ts";
import type { Lane, Ledger, Task } from "./ledger.ts";
import { list } from "./letters.ts";

/** Whether `task` waits on the task `on` through `after`, however far down: it comes after it, not beside it. */
function waitsOn(ledger: Ledger, task: Task, on: string, seen = new Set<string>()): boolean {
  return (task.after ?? []).some((id) => {
    if (id === on) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const before = ledger.tasks[id];
    return before !== undefined && waitsOn(ledger, before, on, seen);
  });
}

/** The lane's code tasks written beside `task`, or about to be: for one in the lane's copy, only those in copies of their own. */
export function besideOf(ledger: Ledger, task: Task): Task[] {
  return Object.values(ledger.tasks).filter(
    (other) => other.lane === task.lane && other.id !== task.id && other.kind === "code" && !SETTLED.includes(other.status) && (task.mode === "parallel" || other.mode === "parallel") && !waitsOn(ledger, other, task.id),
  );
}

/** Who writes beside a task and what they hold. */
function besideLine(task: Task, beside: Task[]): string {
  if (beside.length === 0) return "";
  const where = task.mode === "parallel" ? "in copies of their own or the lane's" : "in copies of their own";
  const who = beside.map((other) => `${other.id} (${other.title})${other.holds.length > 0 ? ` holds ${other.holds.join(", ")}` : ""}`).join("; ");
  return `Beside you, ${where}, each merged into the lane branch once accepted: ${who}. What they write reaches your copy only as your hand-back brings the lane in: leave it to them, and ask if you need it first.`;
}

/** Where a task starts and what bounds it: hints are a start to read from; a parallel task writes in what it holds, one in the lane's copy wherever its goal reaches in the lane's write set. */
function whereLines(task: Task, lane: Lane): string[] {
  const start = task.hints.length > 0 ? ["Where to start reading (a start, not a fence):", list(task.hints), ""] : [];
  if (task.mode === "parallel") return [...start, "You hold (others write beside you, so ask before writing outside it):", list(task.holds)];
  const writes = lane.writeSet.length > 0 ? `, inside the lane's write set: ${lane.writeSet.join(", ")}` : "";
  return [...start, `Where the change goes, callers and tests included, is yours to find${writes}.`];
}

export function taskBrief(task: Task, lane: Lane, beside: Task[]): string {
  return [
    `TASK ${task.id}: ${task.title}`,
    "",
    `Goal: ${task.goal}`,
    "",
    "Acceptance:",
    list(task.acceptance),
    "",
    ...whereLines(task, lane),
    "",
    "Out of scope:",
    list(task.outOfScope),
    "",
    `Context: ${task.context?.trim() || "none"}`,
    task.skills && task.skills.length > 0 ? `\nSkills to open: ${task.skills.join(", ")}` : "",
    "",
    besideLine(task, beside),
    "",
    task.mode === "parallel"
      ? `You are on branch ${task.branch} in your own working copy, branched from ${lane.branch}. Commit your work on this branch, then call done.`
      : `You work on branch ${task.branch} in the lane's working copy, branched from ${lane.branch}. Commit your work there, then call done.${task.startSha ? ` Your task started from ${task.startSha}: that is BASE for anything that asks what existed before you began.` : ""}`,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

/** `change` says where the change can be read and how; the desk works it out, because where it is depends on what has happened to the task's copy and branch since. */
export function reviewBrief(review: Task, target: Task | undefined, focus: string, place: { where: string; range?: string }): string {
  const lines = target
    ? [
        `REVIEW ${review.id} of ${target.id}: ${target.title}`,
        "",
        `${place.where}; see it with ${place.range ?? ""}.`,
        "",
        `Goal of the change: ${target.goal}`,
        "",
        "Acceptance it must meet:",
        list(target.acceptance),
      ]
    : [`REVIEW ${review.id}: ${review.title}`, "", `${place.where} Read whatever the question needs.`];
  lines.push("", "Open question:", focus);
  if (review.asked) lines.push("", "The project asks every review of a change like this, answered in order in answers:", ...review.asked.map((question, index) => `${index + 1}. ${question}`));
  lines.push("", "Read only: don't edit files or commit. When finished, call done with your verdict and findings.");
  return lines.join("\n");
}
