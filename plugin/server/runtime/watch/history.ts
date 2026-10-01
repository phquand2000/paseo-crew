import type { Ledger } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { SETTLED } from "../../domain/task.ts";
import { type Fact, type FactKind, fact } from "./fact-kinds.ts";

/**
 * What a lane's history shows that no turn window can. One fact per kind per lane, naming every task:
 * incidents key on seat and kind, and the exact quote is how a standing condition is not re-raised.
 */
type Seen = { seat: string; fact: Fact };

type Reading = { reworksAt: number };

const CERTAIN =
  /\b(?:report|raise|flag|list|mention|include)\b[^.]{0,20}\bonly\b[^.]{0,40}\b(?:certain|sure|confident|proven|prove|confirmed|verified)\b|\bonly\b[^.]{0,20}\b(?:report|raise|flag|list|mention)\b[^.]{0,40}\b(?:certain|sure|confident|proven|prove|confirmed|verified)\b|\bno\s+(?:speculation|speculative|guesswork|guesses|hypotheses|maybes)\b|\bhigh[- ]confidence\b[^.]{0,20}\bonly\b|\bonly\b[^.]{0,20}\bhigh[- ]confidence\b|\b(?:do\s*n[o']?t|never)\s+(?:report|raise|flag)\b[^.]{0,30}\bunless\b/i;

const CODE_FENCE =
  /```[\s\S]*?(?:^|\n)\s*(?:import|from|export|const|let|var|def|class|function|fn|public|private|#include|package)\b/;
const BUILD_STEP =
  /^\s*(?:step\s*)?[1-9][.)]\s*(?:then\s+)?(?:create|add|write|edit|update|rename|move|delete|remove|implement|refactor|extract|install|register|wire|import|export)\b/im;
const THEN_BUILD = /\b(?:then|next|after that)\b[^.]{0,30}\b(?:create|add|write|edit|rename|move|delete|implement)\b/i;
const FILE_AND_MEMBER =
  /\b[\w-]+(?:\/[\w-]+)*\.[a-z]{1,4}\b[^.]{0,40}\b(?:function|method|class|const|export|field|column|endpoint)\b/i;

const READ_AT_MOST = 4000;

const short = (text: string, limit = 120): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

const reworksOf = (task: Task): number => task.reworks ?? 0;
const settled = (task: Task): boolean => SETTLED.includes(task.status);

/** Whether a brief hands over an answer to be typed in rather than an outcome to be reached. */
function prewritten(text: string): boolean {
  const read = text.slice(0, READ_AT_MOST);
  if (!read.trim()) return false;
  if (CODE_FENCE.test(read)) return true;
  if (!BUILD_STEP.test(read)) return false;
  return THEN_BUILD.test(read) || FILE_AND_MEMBER.test(read);
}

/** What the record shows of one open lane: its tasks and the settings it is read by. */
type LaneRecord = { here: Task[]; reading: Reading };

type Finding = [FactKind, string] | undefined;

export function deskFacts(ledger: Ledger, reading: Reading): Seen[] {
  const tasks = Object.values(ledger.tasks);
  return Object.values(ledger.lanes)
    .filter((lane) => lane.status === "open" && lane.lead)
    .flatMap((lane) => {
      const record = { here: tasks.filter((task) => task.lane === lane.id), reading };
      return LANE_FACTS.map((find) => find(record))
        .filter((found): found is [FactKind, string] => found !== undefined)
        .map(([kind, quote]) => ({ seat: lane.lead!, fact: fact(kind, quote) }));
    });
}

/** The lane going round: several tasks sent back is one missing foundation patched task by task. */
function patchedNotFixed({ here, reading }: LaneRecord): Finding {
  const patched = here.filter((task) => !settled(task) && reworksOf(task) > 0);
  const sendings = patched.reduce((total, task) => total + reworksOf(task), 0);
  if (patched.length < 2 || sendings < reading.reworksAt) return undefined;
  return [
    "patched-not-fixed",
    `${sendings} sendings-back across ${patched.length} tasks still open in this lane: ${patched.map((task) => `${task.id} ×${reworksOf(task)}`).join(", ")}`,
  ];
}

/** A review asked for certainty reports less than it found, and what it drops is real. */
function certaintyOnly({ here }: LaneRecord): Finding {
  const timid = here.filter((task) => task.kind === "review" && CERTAIN.test(task.goal.slice(0, READ_AT_MOST)));
  if (timid.length === 0) return undefined;
  return [
    "certainty-only",
    timid.map((task) => `${task.id} asks its reviewer for only what it is sure of: ${short(task.goal)}`).join("; "),
  ];
}

/** A brief that carries the answer gets agreement back, not engineering. */
function briefPrewritten({ here }: LaneRecord): Finding {
  const typed = here.filter(
    (task) => task.kind === "code" && !settled(task) && prewritten(`${task.goal}\n${task.context ?? ""}`),
  );
  if (typed.length === 0) return undefined;
  return [
    "brief-prewritten",
    typed
      .map(
        (task) =>
          `${task.id}'s brief writes the work out rather than setting an outcome: ${short(task.context?.trim() || task.goal)}`,
      )
      .join("; "),
  ];
}

/** Each fact the record can show of a lane, in the order its Lead reads them. */
const LANE_FACTS = [patchedNotFixed, certaintyOnly, briefPrewritten];
