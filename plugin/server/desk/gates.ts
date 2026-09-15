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

export function gateNote(project: Project): string {
  return loadConfig(project.state).gate ? "runs on the whole lane when you report it ready" : "none set";
}
