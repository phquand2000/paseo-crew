import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { postJsonRpc } from "../core/jsonrpc.ts";
import { expandHome } from "../core/paths.ts";
import { type Kit, hookTools } from "../catalog/kit.ts";
import { type Team, connectToServer, proxyOf } from "../catalog/team.ts";

export type Check = { id: string; ok: boolean; detail: string };

export type Probes = {
  has(bin: string): boolean;
  exists(path: string): boolean;
  post(url: string, body: unknown, timeoutMs: number): Promise<{ ok: boolean; json?: any; error?: string }>;
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
  post: postJsonRpc,
};

export async function doctor(kit: Kit, team: Team, probes: Probes = realProbes): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push({ id: "settings", ok: team.errors.length === 0, detail: team.errors.length === 0 ? "The settings resolve to a complete team." : team.errors.join("\n") });
  for (const bin of ["git", "jq"]) {
    // Asked once. `has` spawns a shell and blocks the loop the seats' own tool calls are served on,
    // and a second answer that disagreed with the first would have said both things at once.
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
    // One server per pass, wrapped: what an outside server answers is nobody's guarantee, and the
    // settings and harness checks computed before it are what the owner opened this panel for.
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
        // As the http branch below already does. Falling through pushed a second check under the same
        // id, probing a pasted connection that a proxy entry's seats never use: `serversFor` builds a
        // proxy from its own backend and never looks at `connect`.
        continue;
      }
      if (proxy?.backend.type === "http") {
        const { url } = proxy.backend;
        const listed = await probes.post(url, { jsonrpc: "2.0", id: 1, method: "tools/list" }, 3000);
        if (!listed.ok || !Array.isArray(listed.json?.result?.tools)) {
          checks.push({ id: `mcp:${state.id}`, ok: false, detail: `No ${state.label} server answered at ${url}.${help}` });
          continue;
        }
        // An outside server's answer is data, not a shape to trust: one null entry used to throw out of
        // here and take every check computed before it with it, settings and harnesses included.
        const exposed = new Set<string>(
          (listed.json.result.tools as unknown[]).filter((tool): tool is { name: string } => Boolean(tool) && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string").map((tool) => tool.name),
        );
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
        // A transport the settings accept, the harness advertises and the seats use — and one this
        // probe does not speak. Run against the streamable-HTTP handshake it answers nothing, and a
        // server the team is using every day was reported as never having answered.
        checks.push({ id: `mcp:${state.id}`, ok: true, detail: `${state.label} is an SSE server at ${direct.url}; the desk does not probe that transport, so this is not a check.${help}` });
      } else if (direct?.url) {
        const answered = await probes.post(direct.url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "seatworks-doctor", version: "2" } } }, 8000);
        const ok = answered.ok && Boolean(answered.json?.result);
        checks.push({ id: `mcp:${state.id}`, ok, detail: ok ? `${state.label} answered.` : `${state.label} did not answer: ${answered.error ?? "no MCP result"}.` });
      }
    } catch (error) {
      checks.push({ id: `mcp:${state.id}`, ok: false, detail: `${state.label} could not be checked: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return checks;
}
