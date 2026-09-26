import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Kit } from "../../catalog/kit/kit.ts";
import { clip } from "../../core/text.ts";
import type { Case } from "./judging.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { type Project, riskRulesOf } from "../project/project.ts";

const SAID = 3000;

/** One moment of a watched seat's turn: the facts the code found in it, the seat's latest instruction and who sent it, and the turn. */
export type Moment = {
  facts: { kind: string; quote: string }[];
  instruction?: { text: string; from: string[] };
  turn: string | null;
};

/**
 * What a hand-back asks: of a task handed back complete, whether its summary says something asked for was not done; of a
 * review that accepts a change risk rules reach, whether its report says each rule's invariant was checked by running code.
 */
export function handbackCase(
  kit: Kit,
  project: Project,
  task: Task,
  handback: { file: string; outcome: string; summary: string; body: string },
): Case | undefined {
  const episode = basename(handback.file);
  if (task.kind === "code") {
    if (handback.outcome !== "complete") return undefined;
    return {
      subject: task.id,
      episode,
      state: { summary: clip(handback.summary, SAID), out_of_scope: task.outOfScope },
      asked: { summary_admits_gap: { check: "summary_admits_gap" } },
    };
  }
  if (handback.outcome !== "accept") return undefined;
  const invariants = [
    ...new Set(
      riskRulesOf(project, kit)
        .filter((rule) => task.asked?.includes(rule.reviewQuestion))
        .map((rule) => rule.invariant),
    ),
  ];
  if (invariants.length === 0) return undefined;
  const asked = Object.fromEntries(
    invariants.map((invariant, index) => [
      `review_ran_invariant__${index + 1}`,
      { check: "review_ran_invariant", fill: { invariant } },
    ]),
  );
  return { subject: task.id, episode, state: { report: clip(handback.body, SAID) }, asked };
}

/** The hand-back as its reader has it, without the title the desk put on the file; one that cannot be read is not asked about. */
function handbackOf(task: Task): string | undefined {
  try {
    return clip(readFileSync(task.handback!.file, "utf-8").replace(/^# .*\n+/, ""), SAID);
  } catch {
    return undefined;
  }
}

/**
 * What a moment asks: whether each act the catalog words was asked for, whether a hand-back the record does not back says
 * its checks pass, and what an instruction acted on unchecked did; nothing that reads an instruction the window has lost.
 */
export function momentCases(kit: Kit, place: { lane?: Lane; task?: Task }, moment: Moment): Case[] {
  const { task, lane } = place;
  const work = task
    ? { subject: task.id, goal: task.goal, acceptance: task.acceptance, out_of_scope: task.outOfScope }
    : lane && { subject: lane.id, goal: lane.outcome, acceptance: lane.acceptance, out_of_scope: lane.outOfScope };
  if (!work) return [];
  const { subject, ...asked } = work;
  const episode = moment.turn ?? "turn";
  const instruction = clip(moment.instruction?.text ?? "", SAID);
  const cases: Case[] = [];
  const check = kit.checks.asked_for;
  const acts = check?.type === "noul" ? (check.acts ?? {}) : {};
  const opened = moment.facts.filter((found) => Object.hasOwn(acts, found.kind));
  if (instruction && opened.length > 0) {
    const fills = opened.map((found, index): [string, Case["asked"][string]] => [
      `asked_for__${index + 1}`,
      { check: "asked_for", fill: { act: acts[found.kind]!.replaceAll("{quote}", () => found.quote) } },
    ]);
    cases.push({ subject, episode, state: { instruction, ...asked }, asked: Object.fromEntries(fills) });
  }
  const handback =
    task?.handback && moment.facts.some((found) => found.kind === "unverified" || found.kind === "claim-contradicted")
      ? handbackOf(task)
      : undefined;
  if (task?.handback && handback)
    cases.push({
      subject: task.id,
      episode: basename(task.handback.file),
      state: { handback },
      asked: { claims_checks_pass: { check: "claims_checks_pass" } },
    });
  const kind = kit.checks.instruction_kind;
  const after = kind?.type === "choice" ? kind.after : undefined;
  const from = moment.instruction?.from ?? [];
  if (
    instruction &&
    moment.facts.some((found) => found.kind === "edit-before-look") &&
    (!after || from.some((sender) => after.includes(sender)))
  ) {
    cases.push({
      subject,
      episode,
      state: { instruction },
      asked: { instruction_kind: { check: "instruction_kind" } },
    });
  }
  return cases;
}
