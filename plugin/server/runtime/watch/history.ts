import type { Ledger, Task } from "../../desk/ledger.ts";
import type { Fact } from "./facts.ts";

/**
 * What a lane's history shows that no single turn can.
 *
 * `facts.ts` reads eighty steps from the last instruction, and a letter restarts that window — so a
 * third sending-back, a fourth review of one task, or a brief that carried its own answer are all
 * invisible there by construction. They are in the ledger, which the patrol already holds, and they
 * are the shapes `docs/ANTIPATTERNS.md` calls desk-shaped.
 *
 * Every fact here is a standing condition rather than an episode: a task sent back three times stays
 * sent back three times. So each carries a `sign` that changes only when the evidence does, and the
 * patrol reports one only when its sign is new. Without that, a condition nobody can undo would open
 * an incident again on every round after it was marked.
 */
export type Seen = { seat: string; fact: Fact; sign: string };

export type Reading = {
  /** How many sendings-back are a loop rather than a correction. */
  reworksAt: number;
  /** How many reviews of one task are a search for a verdict rather than a check. */
  reviewsAt: number;
};

/** A reviewer told to withhold what it is not sure of reports less than it found. */
const CERTAIN = /\b(only|just)\b[^.]{0,40}\b(certain|sure|confident|definite|confirmed|proven)\b|\bno\s+(speculation|guess\w*|maybe\w*|hypothes\w+)\b|\bhigh[- ]confidence\s+only\b|\bdo\s*n[o']?t\s+report\b[^.]{0,30}\bunless\b/i;

/** A brief that writes the code in prose leaves the worker a typist and still has not tested the design. */
const FENCED = /```/;
const STEPS = /^\s*(?:step\s*)?[1-5][.)]\s+\S/im;
const THEN_DO = /\b(?:then|next|after that)\b[^.]{0,30}\b(?:create|add|write|rename|move|delete)\b/i;

const FILE_AND_MEMBER = /\b[\w./-]+\.[a-z]{1,4}\b[^.]{0,40}\b(?:function|method|class|const|export|field|column|endpoint)\b/i;

const short = (text: string, limit = 120): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

const reworksOf = (task: Task): number => task.reworks ?? 0;

/** Whether a brief hands over an answer to be typed in rather than an outcome to be reached. */
export function prewritten(text: string): boolean {
  if (!text.trim()) return false;
  // A brief carrying code has handed the answer over whatever else it says.
  if (FENCED.test(text)) return true;
  const marks = [STEPS, THEN_DO].filter((pattern) => pattern.test(text)).length;
  return marks >= 2 || (marks >= 1 && FILE_AND_MEMBER.test(text));
}

export function deskFacts(ledger: Ledger, reading: Reading): Seen[] {
  const seen: Seen[] = [];
  const tasks = Object.values(ledger.tasks);
  for (const lane of Object.values(ledger.lanes)) {
    if (lane.status !== "open" || !lane.lead) continue;
    const lead = lane.lead;
    const here = tasks.filter((task) => task.lane === lane.id);
    const at = (kind: string, sign: string, quote: string) => seen.push({ seat: lead, fact: { kind, level: "attend", quote }, sign });

    // One task going round: each sending-back is a local fix to what the last one did not settle.
    for (const task of here.filter((task) => reworksOf(task) >= reading.reworksAt)) {
      at("rework-loop", `${task.id}:${reworksOf(task)}`, `${task.id} (${task.title}) has been sent back ${reworksOf(task)} times; the last outcome was ${task.handback?.outcome ?? "none recorded"}`);
    }

    // The lane going round: several tasks each sent back, which is one missing foundation being
    // patched a task at a time rather than one task being got right.
    const patched = here.filter((task) => reworksOf(task) > 0);
    const sendings = patched.reduce((total, task) => total + reworksOf(task), 0);
    if (patched.length >= 2 && sendings >= reading.reworksAt) {
      at("patched-not-fixed", `${patched.length}:${sendings}`, `${sendings} sendings-back across ${patched.length} tasks in this lane: ${patched.map((task) => `${task.id} ×${reworksOf(task)}`).join(", ")}`);
    }

    // Reviews piling up on one task with nothing accepted: ten symptoms and no convergence.
    const reviews = new Map<string, Task[]>();
    for (const task of here) if (task.kind === "review" && task.of) reviews.set(task.of, [...(reviews.get(task.of) ?? []), task]);
    for (const [target, rounds] of reviews) {
      const settled = ledger.tasks[target]?.status;
      if (rounds.length < reading.reviewsAt || settled === "merged" || settled === "cut") continue;
      at("reviews-unconverged", `${target}:${rounds.length}`, `${rounds.length} reviews of ${target} (${ledger.tasks[target]?.title ?? "gone"}), which is ${settled ?? "gone"}: ${rounds.map((task) => task.handback?.outcome ?? task.status).join(", ")}`);
    }

    for (const task of here) {
      // A review asked for certainty reports less than it found, and what it drops is real.
      if (task.kind === "review" && CERTAIN.test(task.goal)) {
        at("certainty-only", `${task.id}`, `${task.id} asks its reviewer for only what it is sure of: ${short(task.goal)}`);
      }
      // A brief that carries the answer gets agreement back, not engineering.
      if (task.kind === "code" && prewritten(`${task.goal}\n${task.context ?? ""}`)) {
        at("brief-prewritten", `${task.id}`, `${task.id}'s brief writes the work out rather than setting an outcome: ${short(task.context?.trim() || task.goal)}`);
      }
    }
  }
  return seen;
}
