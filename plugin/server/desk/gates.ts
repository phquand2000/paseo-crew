import { join } from "node:path";
import { runGate } from "../core/gate.ts";
import { isPristine } from "../core/git.ts";
import type { DeskContext } from "./context.ts";
import type { Lane } from "./ledger.ts";
import { type Project, loadConfig } from "./project.ts";

export type GateVerdict = { ok: boolean; text: string };

export async function laneGate(ctx: DeskContext, project: Project, lane: Lane): Promise<GateVerdict> {
  const config = loadConfig(project.state);
  if (!config.gate || !lane.worktree) return { ok: true, text: "no gate set" };
  if (!(await isPristine(lane.worktree))) return { ok: false, text: "the lane working copy has uncommitted changes" };
  const logFile = join(project.state, "gates", `${lane.id}-${Date.now()}.log`);
  const result = await runGate(config.gate, lane.worktree, logFile, config.gateTimeoutMinutes * 60_000);
  ctx.event(project, { kind: result.ok ? "gate.passed" : "gate.failed", lane: lane.id, seconds: result.seconds });
  if (result.ok) return { ok: true, text: `${config.gate} passed on the lane branch in ${result.seconds}s` };
  const reason = result.timedOut ? `timed out after ${config.gateTimeoutMinutes} minutes` : `failed with exit ${result.code}`;
  return { ok: false, text: `${config.gate} ${reason} on the lane branch.\n\n${result.tail}\n\nFull log: ${logFile}` };
}

export type GateRun = { ok: boolean; note: string; reason: string; tail: string; logFile: string };

/** The one owner of "run the gate on a task". Returns undefined when this project does not gate tasks. */
export async function taskGate(project: Project, taskId: string, cwd: string): Promise<GateRun | undefined> {
  const config = loadConfig(project.state);
  if (!config.gate || config.gateOn !== "task") return undefined;
  const logFile = join(project.state, "gates", `${taskId}-${Date.now()}.log`);
  const result = await runGate(config.gate, cwd, logFile, config.gateTimeoutMinutes * 60_000);
  const reason = result.timedOut ? `the gate timed out after ${config.gateTimeoutMinutes} minutes` : `the gate failed with exit ${result.code}`;
  return { ok: result.ok, note: result.ok ? `${config.gate} passed in ${result.seconds}s` : `${config.gate}: ${reason}`, reason, tail: result.tail, logFile };
}

export function gateNote(project: Project): string {
  return loadConfig(project.state).gate ? "runs on the whole lane when you report it ready" : "none set";
}
