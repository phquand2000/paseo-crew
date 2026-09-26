import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Check } from "../../../shared/views.ts";
import type { Kit, ProxySpec } from "../../catalog/kit/kit.ts";
import { connectToServer, hookTools, proxyOf } from "../../catalog/seat/servers.ts";
import type { McpState } from "../../catalog/team/mcp-states.ts";
import type { RoleSeat } from "../../catalog/team/role-seats.ts";
import type { Team } from "../../catalog/team/team.ts";
import { errorText } from "../../core/errors.ts";
import { reaches, toolNames } from "../../core/mcp-client.ts";
import { expandHome } from "../../core/paths.ts";

type Probes = {
  has(bin: string): boolean;
  exists(path: string): boolean;
  tools(url: string, timeoutMs: number): Promise<{ names?: string[]; error?: string }>;
  reaches(url: string, timeoutMs: number): Promise<{ ok: boolean; error?: string }>;
};

export const realProbes: Probes = {
  has(bin) {
    try {
      execFileSync("/bin/sh", ["-c", 'command -v "$1"', "sh", bin], { stdio: "ignore", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  },
  exists: existsSync,
  tools: toolNames,
  reaches,
};

/** What the panel's Health section shows: the settings, the tools on PATH, each agent the seats run on, and each MCP server in use. */
export async function doctor(kit: Kit, team: Team): Promise<Check[]> {
  const settings = {
    id: "settings",
    ok: team.errors.length === 0,
    detail: team.errors.length === 0 ? "The settings resolve to a complete team." : team.errors.join("\n"),
  };
  const checks: Check[] = [settings, ...binChecks(), ...harnessChecks(kit, team)];
  for (const state of Object.values(team.mcp).filter((server) => server.enabled)) {
    const check = await serverCheck(team, state);
    if (check) checks.push(check);
  }
  return checks;
}

function binChecks(): Check[] {
  return ["git", "jq"].map((bin) => {
    // Asked once: `has` spawns a shell and blocks the loop the seats' tool calls are served on.
    const ok = realProbes.has(bin);
    return { id: `bin:${bin}`, ok, detail: ok ? `${bin} is on PATH.` : `${bin} is not on PATH; seats need it.` };
  });
}

/** Each agent the team's seats run on: its command on PATH, and the files its harness says it needs. */
function harnessChecks(kit: Kit, team: Team): Check[] {
  const harnesses = new Map<string, string[]>();
  for (const seat of Object.values(team.roles))
    harnesses.set(seat.harness.id, [...(harnesses.get(seat.harness.id) ?? []), seat.role.label]);
  const checks: Check[] = [];
  for (const [id, roles] of harnesses) {
    const harness = kit.harnesses[id]!;
    const bin = harness.provider.env?.SEATWORKS_AGENT_BIN;
    if (bin) {
      const ok = realProbes.has(bin);
      checks.push({
        id: `harness:${id}`,
        ok,
        detail: ok
          ? `${harness.label} (${bin}) is installed for ${roles.join(", ")}.`
          : `${harness.label} needs \`${bin}\` on PATH for ${roles.join(", ")}.`,
      });
    }
    for (const check of harness.checks ?? []) {
      const path = expandHome(check.path);
      const ok = realProbes.exists(path);
      checks.push({
        id: `harness:${id}:${check.path}`,
        ok,
        detail: ok
          ? `${harness.label} has ${path}.`
          : `${harness.label} needs ${path} for ${roles.join(", ")}. ${check.help}`,
      });
    }
  }
  return checks;
}

/** An enabled server some seat uses; one that throws is that server's failed check, not the loss of the checks before it. */
async function serverCheck(team: Team, state: McpState): Promise<Check | undefined> {
  try {
    const users = Object.values(team.roles).filter((seat) => seat.mcp.includes(state.id));
    if (users.length === 0) return undefined;
    const help = state.entry?.help ? ` ${state.entry.help}` : "";
    const proxy = proxyOf(state);
    // Proxy entries never use `connect`: `serversFor` builds a proxy from its own backend.
    return proxy ? await proxyCheck(state, proxy, users, help) : await directCheck(state, help);
  } catch (error) {
    return { id: `mcp:${state.id}`, ok: false, detail: `${state.label} could not be checked: ${errorText(error)}` };
  }
}

/** A proxy's backend: its command on PATH, or a server at its address exposing every tool the team uses of it. */
async function proxyCheck(state: McpState, proxy: ProxySpec, users: RoleSeat[], help: string): Promise<Check> {
  const id = `mcp:${state.id}`;
  if (proxy.backend.type === "stdio") {
    const bin = proxy.backend.command[0] ?? "";
    const ok = Boolean(bin) && realProbes.has(bin);
    return {
      id,
      ok,
      detail: ok ? `${state.label} starts through ${bin}.` : `${state.label} needs \`${bin}\` on PATH.${help}`,
    };
  }
  const { url } = proxy.backend;
  const listed = await realProbes.tools(url, 3000);
  if (!listed.names) return { id, ok: false, detail: `No ${state.label} server answered at ${url}.${help}` };
  const exposed = new Set(listed.names);
  const needed = new Set<string>([
    ...hookTools(proxy),
    ...users.flatMap((seat) => (state.tools ?? state.entry?.tools)?.[seat.role.role] ?? []),
  ]);
  const missing = [...needed].filter((tool) => !exposed.has(tool)).sort();
  return {
    id,
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `${state.label} at ${url} exposes every tool the team uses.`
        : `${state.label} at ${url} doesn't expose ${missing.join(", ")}.${help}`,
  };
}

/** A server the seats reach themselves: its command on PATH, or an address that answers; an SSE server is not probed. */
async function directCheck(state: McpState, help: string): Promise<Check | undefined> {
  const id = `mcp:${state.id}`;
  const shaped = state.connect ? connectToServer(state.connect) : undefined;
  const direct = (shaped ?? (state.entry?.server ? { ...state.entry.server } : undefined)) as
    { type?: string; command?: string; url?: string } | undefined;
  if (direct?.type === "stdio" && direct.command) {
    const ok = realProbes.has(direct.command);
    return {
      id,
      ok,
      detail: ok
        ? `${state.label} starts through ${direct.command}.`
        : `${state.label} needs \`${direct.command}\` on PATH.${help}`,
    };
  }
  // This probe does not speak SSE; run against it, a working server read as never answering.
  if (direct?.type === "sse" && direct.url)
    return {
      id,
      ok: true,
      detail: `${state.label} is an SSE server at ${direct.url}; the desk does not probe that transport, so this is not a check.${help}`,
    };
  if (!direct?.url) return undefined;
  const answered = await realProbes.reaches(direct.url, 8000);
  return {
    id,
    ok: answered.ok,
    detail: answered.ok
      ? `${state.label} answered.`
      : `${state.label} did not answer: ${answered.error ?? "no MCP result"}.`,
  };
}
