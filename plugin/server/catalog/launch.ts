import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { type Kit, type McpServers, type RoleSpec, seatOf } from "./kit.ts";
import type { Team } from "./team.ts";

export type AgentConfig = PluginBeforeRequests["agent.create"]["config"];
export type SessionOpen = PluginBeforeRequests["agent.session_open"];
export type RenderPrompt = (role: RoleSpec) => string;

function allowStateWrites(options: unknown, state: string): Record<string, unknown> {
  const base = (options && typeof options === "object" ? options : {}) as Record<string, any>;
  const settings = { ...(base.settings ?? {}) };
  const sandbox = { ...(settings.sandbox ?? {}) };
  const filesystem = { ...(sandbox.filesystem ?? {}) };
  filesystem.allowWrite = [...new Set([...(filesystem.allowWrite ?? []), state])];
  return { ...base, settings: { ...settings, sandbox: { ...sandbox, filesystem } } };
}

export function applyRole(kit: Kit, team: Team, config: AgentConfig, render: RenderPrompt, state?: string, servers: McpServers = {}): AgentConfig {
  const seat = seatOf(kit, config.provider);
  if (!seat) return config;
  const { role, harness } = seat;
  const chosen = team.roles[role.role];
  const sameHarness = chosen?.harness.id === harness.id;
  const models = harness.models ?? [];
  const model =
    models.find((entry) => entry.id === config.model) ??
    (sameHarness ? chosen?.model : undefined) ??
    models.find((entry) => entry.isDefault) ??
    models[0];
  const next: AgentConfig = { ...config };
  if (model) next.model = model.id;
  if (harness.provider.profileModeId) next.modeId = harness.provider.profileModeId;
  const options = harness.hasThinking === false ? [] : (model?.thinkingOptions ?? []);
  if (options.length === 0) delete next.thinkingOptionId;
  else {
    const preferred = sameHarness && chosen?.model?.id === model?.id ? chosen?.thinking : undefined;
    const valid = (id: string | undefined) => Boolean(id) && options.some((option) => option.id === id);
    next.thinkingOptionId = [config.thinkingOptionId, preferred].find(valid) ?? (options.find((option) => option.isDefault) ?? options[0])!.id;
  }
  if (harness.systemPrompt === "config") {
    const prompt = render(role);
    next.systemPrompt = config.systemPrompt ? `${prompt}\n\n${config.systemPrompt}` : prompt;
  }
  if (harness.mcp.delivery === "launch" && Object.keys(servers).length > 0) {
    next.mcpServers = { ...(config.mcpServers ?? {}), ...servers } as AgentConfig["mcpServers"];
  }
  if (harness.stateAccess === "sandboxAllowWrite" && state) {
    next.providerOptions = allowStateWrites(config.providerOptions, state) as AgentConfig["providerOptions"];
  }
  return next;
}

export function seatEnv(kit: Kit, request: SessionOpen, seatPath: string, project: { root: string; state: string }): SessionOpen {
  const seat = seatOf(kit, request.provider);
  if (!seat) return request;
  return {
    ...request,
    env: {
      ...request.env,
      [seat.harness.configDirEnv]: seatPath,
      SEATWORKS_ROLE: seat.role.role,
      SEATWORKS_PROJECT: project.root,
      SEATWORKS_STATE: project.state,
    },
  };
}
