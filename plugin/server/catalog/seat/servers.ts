import { join } from "node:path";
import type { Connect } from "../../../shared/settings.ts";
import { skillSources } from "../kit/content.ts";
import {
  type Kit,
  type McpServers,
  PASEO_SERVER,
  type ProxySpec,
  type RoleSpec,
  SEAT_KEY,
  TEAM_SERVER,
} from "../kit/kit.ts";
import { can, toolsOf } from "../kit/roles.ts";
import { paseoToolsPolicy } from "../kit/harness-files.ts";
import { type Team, skillDirsFor } from "../team/team.ts";

type McpState = Team["mcp"][string];

export function connectToServer(connect: Connect): Record<string, unknown> | undefined {
  if (connect.type === "stdio") {
    const [command, ...args] = connect.command ?? [];
    if (!command) return undefined;
    return {
      type: "stdio",
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(connect.env ? { env: connect.env } : {}),
    };
  }
  if (!connect.url) return undefined;
  return { type: connect.type, url: connect.url, ...(connect.headers ? { headers: connect.headers } : {}) };
}

function fill(template: string, settings: McpState["settings"]): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in settings ? String(settings[key]) : whole));
}

export type IndexedProxy = ProxySpec & { id: string; label: string; backend: { type: "http"; url: string } };

export function proxyOf(state: McpState): ProxySpec | undefined {
  return state.entry?.proxy
    ? (JSON.parse(fill(JSON.stringify(state.entry.proxy), state.settings)) as ProxySpec)
    : undefined;
}

export function indexedProxies(team: Team): IndexedProxy[] {
  const found: IndexedProxy[] = [];
  for (const state of Object.values(team.mcp)) {
    const proxy = state.enabled ? proxyOf(state) : undefined;
    // Keyed on opening alone, a preset without an open tool lost the sync and git exclude, and a Peer could commit `.idea/`.
    const serves = Boolean(proxy?.open || proxy?.close || proxy?.sync || proxy?.gitExclude?.length);
    if (proxy && serves && proxy.backend.type === "http")
      found.push({ ...proxy, backend: proxy.backend, id: state.id, label: state.label });
  }
  return found;
}

/** The fixed sets a role's desk tools take, by tool and field, read from the kit and team: a seat is shown them as choices. */
export function choicesFor(kit: Kit, team: Team, roleName: string): Record<string, Record<string, string[]>> {
  const holding = (capability: string) => kit.roles.filter((role) => can(role, capability)).map((role) => role.role);
  const writers = holding("write");
  const skills = writers.flatMap((name) =>
    team.roles[name] ? [...skillSources(kit, team.roles[name].role, skillDirsFor(team, name)).keys()] : [],
  );
  const role = team.roles[roleName]?.role;
  const pages = (role?.writes ?? []).filter((entry) => entry.endsWith("/")).map((entry) => entry.slice(0, -1));
  const all = {
    add_tasks: { role: writers, skills: [...new Set(skills)].sort() },
    start_review: { role: holding("review") },
    open_lane: { role: holding("lead") },
    note: { kind: pages },
  };
  const offered = new Set(role ? toolsOf(kit, role) : []);
  return Object.fromEntries(Object.entries(all).filter(([tool]) => offered.has(tool)));
}

/** `key` is the seat's, for a harness handed its servers at launch; one reading them from a file shared by its seats gets none. */
export function serversFor(
  kit: Kit,
  team: Team,
  roleName: string,
  context: { node: string; socket: string },
  key?: string,
): McpServers {
  const seat = team.roles[roleName];
  if (!seat) return {};
  const desk = teamServer(kit, seat.role, context.socket, context.node, key);
  const servers: McpServers =
    desk[TEAM_SERVER] && seat.harness.mcp.desk
      ? { [TEAM_SERVER]: { ...desk[TEAM_SERVER], ...seat.harness.mcp.desk } }
      : { ...desk };
  for (const id of seat.mcp) {
    const state = team.mcp[id]!;
    const { entry } = state;
    if (entry?.kind === "proxy") {
      const tools = (state.tools ?? entry.tools)?.[roleName] ?? [];
      if (tools.length === 0) continue;
      const config = { name: id, label: state.label, instructions: entry.instructions ?? "", tools, ...proxyOf(state) };
      servers[id] = {
        type: "stdio",
        command: context.node,
        args: [join(kit.dir, "mcp", "code.mjs"), JSON.stringify(config)],
      };
      continue;
    }
    const shaped = state.connect
      ? connectToServer(state.connect)
      : entry?.server
        ? (JSON.parse(fill(JSON.stringify(entry.server), state.settings)) as unknown)
        : undefined;
    if (shaped) servers[id] = shaped;
  }
  return servers;
}

export function preapprovedFor(
  kit: Kit,
  team: Team,
  roleName: string,
): { kind: "mcp"; server: string; tool: string }[] {
  const seat = team.roles[roleName];
  if (!seat) return [];
  const refs = (server: string, tools: string[]) => tools.map((tool) => ({ kind: "mcp" as const, server, tool }));
  const approved = seat.role.tools ? refs(TEAM_SERVER, toolsOf(kit, seat.role)) : [];
  // Paseo adds its own server at launch, unless a seat's config already names one; only the tools this role is allowed there.
  const paseo = paseoToolsPolicy(kit, seat.role);
  if (paseo?.enabled !== false)
    approved.push(
      ...refs(
        PASEO_SERVER,
        kit.paseoTools.filter((tool) => !paseo?.disabledTools?.includes(tool)),
      ),
    );
  for (const id of seat.mcp) {
    const state = team.mcp[id]!;
    if (state.entry?.kind === "proxy") approved.push(...refs(id, (state.tools ?? state.entry.tools)?.[roleName] ?? []));
  }
  return approved;
}

/** A seat's own team server, reaching the desk at `socket`; `key` goes in its env where the harness keeps one per seat. */
function teamServer(kit: Kit, role: RoleSpec, socket: string, node: string, key?: string): McpServers {
  if (!role.tools) return {};
  return {
    [TEAM_SERVER]: {
      type: "stdio",
      command: node,
      args: [join(kit.dir, "mcp", "team.mjs"), role.role, role.tools, socket],
      ...(key ? { env: { [SEAT_KEY]: key } } : {}),
    },
  };
}

export function hookTools(proxy: ProxySpec | undefined): string[] {
  return [proxy?.open?.tool, proxy?.close?.tool, proxy?.wait?.tool, proxy?.sync?.tool].filter((name): name is string =>
    Boolean(name),
  );
}
