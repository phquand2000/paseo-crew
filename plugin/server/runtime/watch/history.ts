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
 * One fact of a kind per lane, never one per task. The incident book keys an incident by the seat and
 * the kind, and the seat here is the lane's Lead, so a second task of the same kind would not open a
 * second incident: it would land as an afterword on the first, which is only read by someone who
 * calls `incidents`. So each fact names every task it counted, and its `quote` is the whole of what
 * it saw.
 *
 * That quote is also the memory. Every fact here is a standing condition rather than an episode — a
 * task sent back three times stays sent back three times — so the patrol asks the incident book
 * whether this exact sentence was ever recorded for this seat and kind before raising it. Anything
 * else re-opens a marked incident on the next round, and poisons what the marks are measured against.
 */
export type Seen = { seat: string; fact: Fact };

export type Reading = {
  /** How many sendings-back are a loop rather than a correction. */
  reworksAt: number;
  /** How many reviews of one task are a search for a verdict rather than a check. */
  reviewsAt: number;
};

/**
 * A reviewer told to withhold what it is not sure of reports less than it found.
 *
 * Only a bar on *reporting*. "Review only the merge path" and "make sure the lock is released" narrow
 * the scope and ask for more rigour, not less, and an earlier version of this read both as timidity.
 */
const CERTAIN =
  /\b(?:report|raise|flag|list|mention|include)\b[^.]{0,20}\bonly\b[^.]{0,40}\b(?:certain|sure|confident|proven|prove|confirmed|verified)\b|\bonly\b[^.]{0,20}\b(?:report|raise|flag|list|mention)\b[^.]{0,40}\b(?:certain|sure|confident|proven|prove|confirmed|verified)\b|\bno\s+(?:speculation|speculative|guesswork|guesses|hypotheses|maybes)\b|\bhigh[- ]confidence\b[^.]{0,20}\bonly\b|\bonly\b[^.]{0,20}\bhigh[- ]confidence\b|\b(?:do\s*n[o']?t|never)\s+(?:report|raise|flag)\b[^.]{0,30}\bunless\b/i;

/** A brief that writes the code in prose leaves the worker a typist and still has not tested the design. */
const CODE_FENCE = /```[\s\S]*?(?:^|\n)\s*(?:import|from|export|const|let|var|def|class|function|fn|public|private|#include|package)\b/;
/** A numbered step that tells the seat what to write, as against a numbered acceptance behaviour. */
const BUILD_STEP = /^\s*(?:step\s*)?[1-9][.)]\s*(?:then\s+)?(?:create|add|write|edit|update|rename|move|delete|remove|implement|refactor|extract|install|register|wire|import|export)\b/im;
const THEN_BUILD = /\b(?:then|next|after that)\b[^.]{0,30}\b(?:create|add|write|edit|rename|move|delete|implement)\b/i;
const FILE_AND_MEMBER = /\b[\w-]+(?:\/[\w-]+)*\.[a-z]{1,4}\b[^.]{0,40}\b(?:function|method|class|const|export|field|column|endpoint)\b/i;

/** Nothing caps a brief, and these run for every task on every round. */
const READ_AT_MOST = 4000;

const short = (text: string, limit = 120): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

/** What `done` offers a Peer that could not finish. A missing outcome is stored as "complete". */
const UNFINISHED = new Set(["partial", "blocked"]);

/**
 * How the work came in, when it came in unfinished.
 *
 * A task taken in with no hand-back at all reads as the Lead helping itself, and it was read that way
 * — a Supervisor spent a long turn reading the Peer's own record to find out whether the work had in
 * fact been done. The desk already knew: it counted the quiet turns, nudged the Peer, and wrote the
 * Lead a SILENT letter about them. Saying so here is the difference between a reconstruction and a
 * reading.
 */
function took(task: Task): string {
  if (task.handback) return `after its Peer handed it back ${task.handback.outcome}`;
  if (task.silent > 0) return `after its Peer went quiet ${task.silent === 1 ? "once" : `${task.silent} times`} without handing back`;
  return "though it was never handed back";
}
/** A lane's accepted tasks only ever accumulate, so the quote names a few and counts the rest. */
const MOST_NAMED = 5;

const reworksOf = (task: Task): number => task.reworks ?? 0;
/** A task that was accepted or cut has stopped going round, whatever it took to get there. */
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

    // The lane going round: several tasks each sent back, which is one missing foundation being
    // patched a task at a time rather than one task being got right.
    const patched = here.filter((task) => !settled(task) && reworksOf(task) > 0);
    const sendings = patched.reduce((total, task) => total + reworksOf(task), 0);
    if (patched.length >= 2 && sendings >= reading.reworksAt) {
      at("patched-not-fixed", `${sendings} sendings-back across ${patched.length} tasks still open in this lane: ${patched.map((task) => `${task.id} ×${reworksOf(task)}`).join(", ")}`);
    }

    // Taken in although its Peer never said it was finished. `done` stores a missing outcome as
    // "complete", so "partial" or "blocked" is always something the Peer chose to say, and `accept`
    // refuses only a task that is already merged, queued, merging or cut — never one that has not
    // handed back at all. Accepting either can be the right call; what makes it a finding is that
    // nothing else writes it down. The merge letter carries the counts and the gate, the status page
    // carries the hand-back's age, and what was left undone stays in a file under `handbacks/` that
    // nothing reads again unless someone runs a retrospective.
    const unfinished = here.filter((task) => task.status === "merged" && (!task.handback || UNFINISHED.has(task.handback.outcome)));
    if (unfinished.length > 0) {
      const named = unfinished.slice(0, MOST_NAMED);
      const rest = unfinished.length - named.length;
      at(
        "accepted-unfinished",
        `${named.map((task) => `${task.id} (${task.title}) was accepted ${took(task)}`).join("; ")}${rest > 0 ? `; and ${rest} more in this lane` : ""}`,
      );
    }

    // Reviews piling up on one task with nothing accepted: ten symptoms and no convergence.
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
