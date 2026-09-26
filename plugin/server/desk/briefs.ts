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

/** Who writes beside a task and what they own; a kept Peer is told when nobody does, so a list its last brief gave does not stand. */
function besideLine(task: Task, beside: Task[], kept: boolean): string {
  if (beside.length === 0) return kept ? "Beside you: nobody now." : "";
  const where = task.mode === "parallel" ? "in copies of their own or the lane's" : "in copies of their own and merged into this one as each is accepted";
  const who = beside.map((other) => `${other.id} (${other.title})${other.owned.length > 0 ? ` owns ${other.owned.join(", ")}` : ""}`).join("; ");
  return `Beside you, ${where}: ${who}. What they own may be missing or half-done ${task.mode === "parallel" ? "in your copy" : "here"}: leave it to them, and ask if you need it first.`;
}

export function taskBrief(task: Task, lane: Lane, beside: Task[], kept = false): string {
  return [
    `TASK ${task.id}: ${task.title}`,
    "",
    `Goal: ${task.goal}`,
    "",
    "Acceptance:",
    list(task.acceptance),
    "",
    "Owned paths (change only these):",
    list(task.owned),
    "",
    "Out of scope:",
    list(task.outOfScope),
    "",
    `Context: ${task.context?.trim() || "none"}`,
    task.skills && task.skills.length > 0 ? `\nSkills to open: ${task.skills.join(", ")}` : "",
    "",
    besideLine(task, beside, kept),
    "",
    task.mode === "parallel"
      ? `You are on branch ${task.branch} in your own working copy, branched from ${lane.branch}. Commit your work on this branch, then call done.`
      : `You work on branch ${lane.branch} in the lane's working copy. Commit your work there, then call done.${task.startSha ? ` Your task started from ${task.startSha}: that is BASE for anything that asks what existed before you began.` : ""}`,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}

/** `change` says where the change can be read and how; the desk works it out, because where it is depends on what has happened to the task's copy and branch since. */
export function reviewBrief(review: Task, target: Task | undefined, focus: string, laneBranch: string, change?: { where: string; range: string }): string {
  const lines = target
    ? [
        `REVIEW ${review.id} of ${target.id}: ${target.title}`,
        "",
        `${change?.where ?? "Your working copy holds the change"}; see it with ${change?.range ?? ""}.`,
        "",
        `Goal of the change: ${target.goal}`,
        "",
        "Acceptance it must meet:",
        list(target.acceptance),
      ]
    : [`REVIEW ${review.id}: ${review.title}`, "", `Your working copy is on ${laneBranch}. Read whatever the question needs.`];
  lines.push("", "Open question:", focus);
  if (review.asked) lines.push("", "The project asks every review of a change like this, answered in order in answers:", ...review.asked.map((question, index) => `${index + 1}. ${question}`));
  lines.push("", "Read only: don't edit files or commit. When finished, call done with your verdict and findings.");
  return lines.join("\n");
}
