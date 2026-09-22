import type { Ledger, Task } from "../../desk/ledger.ts";
import type { Fact } from "./facts.ts";

/**
 * What a lane's history shows that no turn window can. One fact per kind per lane, naming every task:
 * incidents key on seat and kind, and the exact quote is how a standing condition is not re-raised.
 */
export type Seen = { seat: string; fact: Fact };

export type Reading = {
  reworksAt: number;
  reviewsAt: number;
};

const CERTAIN =
  /\b(?:report|raise|flag|list|mention|include)\b[^.]{0,20}\bonly\b[^.]{0,40}\b(?:certain|sure|confident|proven|prove|confirmed|verified)\b|\bonly\b[^.]{0,20}\b(?:report|raise|flag|list|mention)\b[^.]{0,40}\b(?:certain|sure|confident|proven|prove|confirmed|verified)\b|\bno\s+(?:speculation|speculative|guesswork|guesses|hypotheses|maybes)\b|\bhigh[- ]confidence\b[^.]{0,20}\bonly\b|\bonly\b[^.]{0,20}\bhigh[- ]confidence\b|\b(?:do\s*n[o']?t|never)\s+(?:report|raise|flag)\b[^.]{0,30}\bunless\b/i;

const CODE_FENCE = /```[\s\S]*?(?:^|\n)\s*(?:import|from|export|const|let|var|def|class|function|fn|public|private|#include|package)\b/;
const BUILD_STEP = /^\s*(?:step\s*)?[1-9][.)]\s*(?:then\s+)?(?:create|add|write|edit|update|rename|move|delete|remove|implement|refactor|extract|install|register|wire|import|export)\b/im;
const THEN_BUILD = /\b(?:then|next|after that)\b[^.]{0,30}\b(?:create|add|write|edit|rename|move|delete|implement)\b/i;
const FILE_AND_MEMBER = /\b[\w-]+(?:\/[\w-]+)*\.[a-z]{1,4}\b[^.]{0,40}\b(?:function|method|class|const|export|field|column|endpoint)\b/i;

const READ_AT_MOST = 4000;

const short = (text: string, limit = 120): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

const UNFINISHED = new Set(["partial", "blocked"]);

/** Says how unfinished work came in, so a Supervisor need not rebuild what the desk already counted. */
function took(task: Task): string {
  if (task.handback) return `after its Peer handed it back ${task.handback.outcome}`;
  if (task.silent > 0) return `after its Peer went quiet ${task.silent === 1 ? "once" : `${task.silent} times`} without handing back`;
  return "though it was never handed back";
}
const MOST_NAMED = 5;

const reworksOf = (task: Task): number => task.reworks ?? 0;
const settled = (task: Task): boolean => task.status === "merged" || task.status === "cut";

/** Whether a brief hands over an answer to be typed in rather than an outcome to be reached. */
export function prewritten(text: string): boolean {
  const read = text.slice(0, READ_AT_MOST);
  if (!read.trim()) return false;
  if (CODE_FENCE.test(read)) return true;
  if (!BUILD_STEP.test(read)) return false;
  return THEN_BUILD.test(read) || FILE_AND_MEMBER.test(read);
}

export function deskFacts(ledger: Ledger, reading: Reading): Seen[] {
  const seen: Seen[] = [];
  const tasks = Object.values(ledger.tasks);
  for (const lane of Object.values(ledger.lanes)) {
    if (lane.status !== "open" || !lane.lead) continue;
    const lead = lane.lead;
    const here = tasks.filter((task) => task.lane === lane.id);
    const at = (kind: string, quote: string) => seen.push({ seat: lead, fact: { kind, level: "attend", quote } });

    // One task going round: each sending-back is a local fix to what the last one did not settle.
    const looping = here.filter((task) => !settled(task) && reworksOf(task) >= reading.reworksAt);
    if (looping.length > 0) {
      at("rework-loop", looping.map((task) => `${task.id} (${task.title}) has been sent back ${reworksOf(task)} times, last outcome ${task.handback?.outcome ?? "none recorded"}`).join("; "));
    }

    // The lane going round: several tasks sent back is one missing foundation patched task by task.
    const patched = here.filter((task) => !settled(task) && reworksOf(task) > 0);
    const sendings = patched.reduce((total, task) => total + reworksOf(task), 0);
    if (patched.length >= 2 && sendings >= reading.reworksAt) {
      at("patched-not-fixed", `${sendings} sendings-back across ${patched.length} tasks still open in this lane: ${patched.map((task) => `${task.id} ×${reworksOf(task)}`).join(", ")}`);
    }

    // `done` stores a missing outcome as complete, so partial/blocked was said, and nothing else records accepting it.
    const unfinished = here.filter((task) => task.status === "merged" && (!task.handback || UNFINISHED.has(task.handback.outcome)));
    if (unfinished.length > 0) {
      const named = unfinished.slice(0, MOST_NAMED);
      const rest = unfinished.length - named.length;
      at(
        "accepted-unfinished",
        `${named.map((task) => `${task.id} (${task.title}) was accepted ${took(task)}`).join("; ")}${rest > 0 ? `; and ${rest} more in this lane` : ""}`,
      );
    }

    const reviews = new Map<string, Task[]>();
    for (const task of here) if (task.kind === "review" && task.of) reviews.set(task.of, [...(reviews.get(task.of) ?? []), task]);
    const unconverged = [...reviews].filter(([target, rounds]) => rounds.length >= reading.reviewsAt && !(ledger.tasks[target] && settled(ledger.tasks[target]!)));
    if (unconverged.length > 0) {
      at("reviews-unconverged", unconverged.map(([target, rounds]) => `${rounds.length} reviews of ${target} (${ledger.tasks[target]?.title ?? "gone"}), which is ${ledger.tasks[target]?.status ?? "gone"}: ${rounds.map((task) => task.handback?.outcome ?? task.status).join(", ")}`).join("; "));
    }

    // A review asked for certainty reports less than it found, and what it drops is real.
    const timid = here.filter((task) => task.kind === "review" && CERTAIN.test(task.goal.slice(0, READ_AT_MOST)));
    if (timid.length > 0) {
      at("certainty-only", timid.map((task) => `${task.id} asks its reviewer for only what it is sure of: ${short(task.goal)}`).join("; "));
    }

    // A brief that carries the answer gets agreement back, not engineering.
    const typed = here.filter((task) => task.kind === "code" && !settled(task) && prewritten(`${task.goal}\n${task.context ?? ""}`));
    if (typed.length > 0) {
      at("brief-prewritten", typed.map((task) => `${task.id}'s brief writes the work out rather than setting an outcome: ${short(task.context?.trim() || task.goal)}`).join("; "));
    }
  }
  return seen;
}
