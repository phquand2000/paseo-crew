import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { reaches, toolNames } from "../core/mcp-client.ts";
import { expandHome } from "../core/paths.ts";
import { type Kit, hookTools } from "../catalog/kit.ts";
import { connectToServer, proxyOf } from "../catalog/servers.ts";
import type { Team } from "../catalog/team.ts";
import { errorText } from "../core/errors.ts";
import type { Check } from "../../shared/views.ts";

export type { Check };

export type Probes = {
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

export async function doctor(kit: Kit, team: Team, probes: Probes = realProbes): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push({ id: "settings", ok: team.errors.length === 0, detail: team.errors.length === 0 ? "The settings resolve to a complete team." : team.errors.join("\n") });
  for (const bin of ["git", "jq"]) {
    // Asked once: `has` spawns a shell and blocks the loop the seats' tool calls are served on.
    const ok = probes.has(bin);
    checks.push({ id: `bin:${bin}`, ok, detail: ok ? `${bin} is on PATH.` : `${bin} is not on PATH; seats need it.` });
  }
  const harnesses = new Map<string, string[]>();
  for (const seat of Object.values(team.roles)) harnesses.set(seat.harness.id, [...(harnesses.get(seat.harness.id) ?? []), seat.role.label]);
  for (const [id, roles] of harnesses) {
    const harness = kit.harnesses[id]!;
    const bin = harness.provider.env?.SEATWORKS_AGENT_BIN;
    if (bin) {
      const ok = probes.has(bin);
      checks.push({ id: `harness:${id}`, ok, detail: ok ? `${harness.label} (${bin}) is installed for ${roles.join(", ")}.` : `${harness.label} needs \`${bin}\` on PATH for ${roles.join(", ")}.` });
    }
    for (const check of harness.checks ?? []) {
      const path = expandHome(check.path);
      const ok = probes.exists(path);
      checks.push({ id: `harness:${id}:${check.path}`, ok, detail: ok ? `${harness.label} has ${path}.` : `${harness.label} needs ${path} for ${roles.join(", ")}. ${check.help}` });
    }
  }
  for (const state of Object.values(team.mcp).filter((server) => server.enabled)) {
    // Wrapped per server: an outside server failing must not lose the checks computed before it.
    try {
      const { entry } = state;
      const users = Object.values(team.roles).filter((seat) => seat.mcp.includes(state.id));
      if (users.length === 0) continue;
      const proxy = proxyOf(state);
      const shaped = state.connect ? connectToServer(state.connect) : undefined;
      const help = entry?.help ? ` ${entry.help}` : "";
      if (proxy?.backend.type === "stdio") {
        const bin = proxy.backend.command[0] ?? "";
        const ok = Boolean(bin) && probes.has(bin);
        checks.push({ id: `mcp:${state.id}`, ok, detail: ok ? `${state.label} starts through ${bin}.` : `${state.label} needs \`${bin}\` on PATH.${help}` });
        // Proxy entries never use `connect`: `serversFor` builds a proxy from its own backend.
        continue;
      }
      if (proxy?.backend.type === "http") {
        const { url } = proxy.backend;
        const listed = await probes.tools(url, 3000);
        if (!listed.names) {
          checks.push({ id: `mcp:${state.id}`, ok: false, detail: `No ${state.label} server answered at ${url}.${help}` });
          continue;
        }
        const exposed = new Set(listed.names);
        const needed = new Set<string>([...hookTools(proxy), ...users.flatMap((seat) => (state.tools ?? entry?.tools)?.[seat.role.role] ?? [])]);
        const missing = [...needed].filter((tool) => !exposed.has(tool)).sort();
        checks.push({
          id: `mcp:${state.id}`,
          ok: missing.length === 0,
          detail: missing.length === 0 ? `${state.label} at ${url} exposes every tool the team uses.` : `${state.label} at ${url} doesn't expose ${missing.join(", ")}.${help}`,
        });
        continue;
      }
      const direct = (shaped ?? (entry?.server ? { ...entry.server } : undefined)) as { type?: string; command?: string; url?: string } | undefined;
      if (direct?.type === "stdio" && direct.command) {
        const ok = probes.has(direct.command);
        checks.push({ id: `mcp:${state.id}`, ok, detail: ok ? `${state.label} starts through ${direct.command}.` : `${state.label} needs \`${direct.command}\` on PATH.${help}` });
      } else if (direct?.type === "sse" && direct.url) {
        // This probe does not speak SSE; run against it, a working server read as never answering.
        checks.push({ id: `mcp:${state.id}`, ok: true, detail: `${state.label} is an SSE server at ${direct.url}; the desk does not probe that transport, so this is not a check.${help}` });
      } else if (direct?.url) {
        const answered = await probes.reaches(direct.url, 8000);
        checks.push({ id: `mcp:${state.id}`, ok: answered.ok, detail: answered.ok ? `${state.label} answered.` : `${state.label} did not answer: ${answered.error ?? "no MCP result"}.` });
      }
    } catch (error) {
      checks.push({ id: `mcp:${state.id}`, ok: false, detail: `${state.label} could not be checked: ${errorText(error)}` });
    }
  }
  return checks;
}
