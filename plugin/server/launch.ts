import type { PluginBeforeRequests, PluginHookAgent, PluginHookContext } from "@getpaseo/plugin/server";
import { deliver } from "./attention";
import { type Kit, projectRoot, roleOf, seatFor } from "./kit";

type PaseoApi = PluginHookContext["paseo"];
type AgentSessionConfig = PluginBeforeRequests["agent.create"]["config"];

export function applyProfile(kit: Kit, config: AgentSessionConfig): AgentSessionConfig {
  const role = roleOf(config.provider);
  if (!seatFor(kit, config.provider)) return config;
  if (!projectRoot(config.cwd)) {
    throw new Error(
      `a ${role} starts only inside a project that has .seatworks/, and ${config.cwd} has none. Leave the workspace out to start it beside you.`,
    );
  }
  const profile = kit.profiles.find((entry) => entry.provider === role);
  if (!profile) return config;
  const offered = [profile.model, ...(kit.providers[role]?.models ?? []).map((model) => model.id)];
  const allowed = [...new Set(offered.filter((model): model is string => Boolean(model)))];
  const model = config.model ?? profile.model;
  if (model && allowed.length > 0 && !allowed.includes(model)) {
    throw new Error(`a ${role} runs ${allowed.join(" or ")}, as its profile says. Leave the model out, or pass ${allowed.length > 1 ? "one of those" : "that one"}.`);
  }
  return {
    ...config,
    model,
    modeId: profile.modeId ?? config.modeId,
    thinkingOptionId: config.thinkingOptionId ?? profile.thinkingOptionId,
  };
}

export async function checkParent(paseo: PaseoApi, kit: Kit, agent: PluginHookAgent): Promise<void> {
  if (!agent.parentAgentId || !seatFor(kit, agent.provider)) return;
  const parent = paseo.agents.ref(agent.parentAgentId);
  await parent.refresh();
  const snapshot = parent.current();
  if (!snapshot) return;
  const parentSeat = seatFor(kit, snapshot.provider);
  if (!parentSeat) return;
  const role = roleOf(agent.provider);
  const mayStart = parentSeat.mayStart ?? [];
  const reasons: string[] = [];
  if (!mayStart.includes(role)) {
    reasons.push(`a ${parentSeat.role} starts ${mayStart.length > 0 ? `only ${mayStart.join(", ")}` : "no agents"}`);
  }
  const home = projectRoot(snapshot.cwd);
  if (home !== projectRoot(agent.cwd)) {
    reasons.push(`it runs outside ${home ?? snapshot.cwd}, where a seat would load another project's prompts and records`);
  }
  if (reasons.length === 0) return;
  await paseo.agents.ref(agent.id).archive();
  await deliver(paseo, snapshot.id, `Agent ${agent.id} (${role}) was archived as soon as it started: ${reasons.join("; ")}.`);
}
