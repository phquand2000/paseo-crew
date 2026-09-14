import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { type Kit, type RoleSpec, defaultModel, defaultThinking, harnessOf, modelsOf, roleOf } from "./kit.ts";

export type AgentConfig = PluginBeforeRequests["agent.create"]["config"];
export type SessionOpen = PluginBeforeRequests["agent.session_open"];
export type RenderPrompt = (role: RoleSpec) => string;

export function applyRole(kit: Kit, config: AgentConfig, render: RenderPrompt): AgentConfig {
  const role = roleOf(kit, config.provider);
  if (!role) return config;
  const harness = harnessOf(kit, role);
  const models = modelsOf(role);
  const model = models.find((entry) => entry.id === config.model) ?? defaultModel(role);
  const next: AgentConfig = { ...config };
  if (model) next.model = model.id;
  if (harness.provider.profileModeId) next.modeId = harness.provider.profileModeId;
  if (harness.hasThinking === false) delete next.thinkingOptionId;
  else {
    const valid = model?.thinkingOptions?.some((option) => option.id === config.thinkingOptionId) ?? false;
    const thinking = valid ? config.thinkingOptionId : defaultThinking(role, model);
    if (thinking) next.thinkingOptionId = thinking;
    else delete next.thinkingOptionId;
  }
  if (harness.systemPrompt === "config") {
    const prompt = render(role);
    next.systemPrompt = config.systemPrompt ? `${prompt}\n\n${config.systemPrompt}` : prompt;
  }
  return next;
}

export function seatEnv(kit: Kit, request: SessionOpen, seat: (role: RoleSpec) => string, project: { root: string; state: string }): SessionOpen {
  const role = roleOf(kit, request.provider);
  if (!role) return request;
  const harness = harnessOf(kit, role);
  return {
    ...request,
    env: {
      ...request.env,
      [harness.configDirEnv]: seat(role),
      SEATWORKS_ROLE: role.role,
      SEATWORKS_PROJECT: project.root,
      SEATWORKS_STATE: project.state,
    },
  };
}

export function launchRefusal(kit: Kit, parentProvider: string | null | undefined, childProvider: string): { parent: RoleSpec; child: RoleSpec } | undefined {
  const parent = roleOf(kit, parentProvider);
  const child = roleOf(kit, childProvider);
  if (!parent || !child) return undefined;
  return (parent.mayStart ?? []).includes(child.role) ? undefined : { parent, child };
}
