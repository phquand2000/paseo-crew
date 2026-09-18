import { join } from "node:path";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { type Kit, type McpServers, type RoleSpec, can, seatOf } from "./kit.ts";
import { stateTargets } from "./content.ts";
import { type Team, rulesFor, skillDirsFor } from "./team.ts";

export type AgentConfig = PluginBeforeRequests["agent.create"]["config"];
export type SessionOpen = PluginBeforeRequests["agent.session_open"];
export type RenderPrompt = (role: RoleSpec) => string;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function appendAt(options: unknown, path: string, value: string): Json {
  const root: Json = isObject(options) ? { ...options } : {};
  const parts = path.split(".");
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor[part] = isObject(cursor[part]) ? { ...cursor[part] } : {};
    cursor = cursor[part] as Json;
  }
  const last = parts[parts.length - 1]!;
  const list = Array.isArray(cursor[last]) ? (cursor[last] as unknown[]) : [];
  cursor[last] = [...new Set([...list, value])];
  return root;
}

/**
 * What a seat's sandboxed shell may write inside the project's state, which is not the whole of it.
 *
 * The grant used to be `state` itself. That directory also holds the desk's own record — the ledger,
 * the strike table, the event log, and `project.json`, whose `gate` the desk runs through `/bin/sh -c`
 * in the daemon, outside the seat's sandbox. So the grant is what the seat's own content tells it to
 * write there (`stateTargets`), and the Lead's project pages, which its directive tells it to keep.
 *
 * This binds the shell only. The same files are kept from the file tools by deny rules in the
 * harness's own settings; a harness with no sandbox and no path rules has neither, and this cannot
 * give it one.
 */
export function stateWrites(kit: Kit, team: Team, role: RoleSpec, state: string): string[] {
  const segments = new Set(stateTargets(kit, role, skillDirsFor(team, role.role), rulesFor(team, role.role)));
  if (can(role, "lead")) segments.add("docs");
  return [...segments].sort().map((segment) => join(state, segment));
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
  if (options.length === 0) {
    // A model outside the catalog has no list to check against; the owner's thinking for it goes through.
    const owned = harness.hasThinking === false ? undefined : sameHarness && chosen?.model?.id === model?.id ? chosen?.thinking : undefined;
    if (owned) next.thinkingOptionId = owned;
    else delete next.thinkingOptionId;
  }
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
  let providerOptions: unknown = config.providerOptions;
  if (harness.stateWrites?.delivery === "launch" && state) {
    for (const path of stateWrites(kit, team, role, state)) providerOptions = appendAt(providerOptions, harness.stateWrites.path, path);
  }
  if (harness.projectContextOption && config.cwd) providerOptions = appendAt(providerOptions, harness.projectContextOption, config.cwd);
  if (providerOptions !== config.providerOptions) next.providerOptions = providerOptions as AgentConfig["providerOptions"];
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
