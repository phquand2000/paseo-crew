import { recordEvent } from "./store/event-log.ts";
import { join } from "node:path";
import { runGate } from "../core/gate.ts";
import { pristineState } from "../core/git.ts";
import type { Kit } from "../catalog/kit.ts";
import type { DeskBase } from "./base.ts";
import { changeOf } from "./landing.ts";
import type { Lane } from "./ledger.ts";
import { type Project, loadConfig, riskRulesOf, rulesFor } from "./project.ts";

/** `ran` is whether anything ran: a lane with no gate and nothing to rehearse passes with nothing run. */
type GateVerdict = { ok: boolean; text: string; ran: boolean };

/** One command on the lane's copy, as whoever lands it reads it: passed, or how it failed with its tail and its log. */
async function onLane(
  project: Project,
  lane: Lane & { worktree: string },
  command: string,
  rehearsing?: string,
): Promise<GateVerdict> {
  const minutes = loadConfig(project.state).gateTimeoutMinutes;
  const logFile = join(project.state, "gates", `${lane.id}-${Date.now()}.log`);
  const result = await runGate(command, lane.worktree, logFile, minutes * 60_000);
  recordEvent(project, {
    kind: result.ok ? "gate.passed" : "gate.failed",
    lane: lane.id,
    seconds: result.seconds,
    command,
  });
  const what = rehearsing ? `${command}, rehearsing that ${rehearsing},` : command;
  if (result.ok) return { ok: true, text: `${what} passed on the lane branch in ${result.seconds}s`, ran: true };
  const reason = result.timedOut ? `timed out after ${minutes} minutes` : `failed with exit ${result.code}`;
  return {
    ok: false,
    text: `${what} ${reason} on the lane branch.\n\n${result.tail}\n\nFull log: ${logFile}`,
    ran: true,
  };
}

/** The project's gate on the lane, then a rehearsal for each risk rule its change reaches: red in any is a red gate. */
export async function laneGate({ kit }: Pick<DeskBase, "kit">, project: Project, lane: Lane): Promise<GateVerdict> {
  const { gate } = loadConfig(project.state);
  const rules = riskRulesOf(project, kit).filter((rule) => rule.rehearse);
  // A change git cannot read is rehearsed against every rule, rather than none.
  const files = rules.length > 0 ? (await changeOf(project, lane)).files : [];
  const rehearsals = files ? rulesFor(rules, files) : rules;
  if ((!gate && rehearsals.length === 0) || !lane.worktree) return { ok: true, text: "no gate set", ran: false };
  const state = await pristineState(lane.worktree);
  if (state !== "clean") {
    return {
      ok: false,
      text:
        state === "dirty"
          ? "the lane working copy has uncommitted changes"
          : `git could not read the lane working copy at ${lane.worktree}`,
      ran: false,
    };
  }
  const copy = { ...lane, worktree: lane.worktree };
  const verdicts: GateVerdict[] = gate ? [await onLane(project, copy, gate)] : [];
  for (const rule of rehearsals) verdicts.push(await onLane(project, copy, rule.rehearse!, rule.invariant));
  return {
    ok: verdicts.every((verdict) => verdict.ok),
    text: verdicts.map((verdict) => verdict.text).join("\n\n"),
    ran: true,
  };
}

type GateRun = { ok: boolean; note: string; tail: string; logFile: string };

/**
 * The one owner of "run the gate on a task": the project's gate, then a rehearsal for each risk rule the task's `files` reach,
 * stopping at the first that fails. Undefined when this project does not gate tasks.
 */
export async function taskGate(
  kit: Kit,
  project: Project,
  taskId: string,
  cwd: string,
  files: string[] | undefined,
): Promise<GateRun | undefined> {
  const config = loadConfig(project.state);
  if (!config.gate || config.gateOn !== "task") return undefined;
  const rules = riskRulesOf(project, kit).filter((rule) => rule.rehearse);
  // A change git cannot read is rehearsed against every rule, rather than none.
  const rehearsals = (files ? rulesFor(rules, files) : rules).map((rule) => ({
    command: rule.rehearse!,
    what: `${rule.rehearse}, rehearsing that ${rule.invariant},`,
  }));
  const notes: string[] = [];
  let last = { ok: true, tail: "", logFile: "" };
  for (const [index, { command, what }] of [{ command: config.gate, what: config.gate }, ...rehearsals].entries()) {
    const logFile = join(project.state, "gates", `${taskId}-${Date.now()}${index > 0 ? `-${index}` : ""}.log`);
    const result = await runGate(command, cwd, logFile, config.gateTimeoutMinutes * 60_000);
    const failed = result.timedOut
      ? `timed out after ${config.gateTimeoutMinutes} minutes`
      : `failed with exit ${result.code}`;
    notes.push(
      result.ok
        ? `${what} passed in ${result.seconds}s`
        : index === 0
          ? `${what}: the gate ${failed}`
          : `${what} ${failed}`,
    );
    last = { ok: result.ok, tail: result.tail, logFile };
    if (!result.ok) break;
  }
  return { ...last, note: notes.join("; ") };
}

/** What the MERGED letter says about the gate, from what actually ran. */
export function gateNote(
  project: Project,
  task?: { handback?: { gate?: { ok: boolean; note: string; over?: string } } },
): string {
  const config = loadConfig(project.state);
  if (!config.gate) return "none set";
  if (config.gateOn !== "task")
    return "not run on merges, so the lane branch can break between reports; it runs on the whole lane when you report it ready";
  const ran = task?.handback?.gate;
  // A red gate merges only over its Lead's word, so a red one here always carries the reason.
  return ran
    ? `ran on this task: ${ran.note}${ran.ok ? "" : ` — merged over it: ${ran.over}`}`
    : "did not run on this task: it was not handed back while the project gated each task";
}
