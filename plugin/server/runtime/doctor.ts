import { execFileSync } from "node:child_process";
import type { Kit } from "../catalog/kit.ts";
import { type Team, proxyUrl } from "../catalog/team.ts";

export type Check = { id: string; ok: boolean; detail: string };

export type Probes = {
  has(bin: string): boolean;
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
  async post(url, body, timeoutMs) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      const start = text.indexOf("{");
      const json = start >= 0 ? JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) : undefined;
      return { ok: response.ok, json };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export async function doctor(kit: Kit, team: Team, probes: Probes = realProbes): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push({ id: "settings", ok: team.errors.length === 0, detail: team.errors.length === 0 ? "The settings resolve to a complete team." : team.errors.join("\n") });
  for (const bin of ["git", "jq"]) {
    checks.push({ id: `bin:${bin}`, ok: probes.has(bin), detail: probes.has(bin) ? `${bin} is on PATH.` : `${bin} is not on PATH; seats need it.` });
  }
  const harnesses = new Map<string, string[]>();
  for (const seat of Object.values(team.roles)) harnesses.set(seat.harness.id, [...(harnesses.get(seat.harness.id) ?? []), seat.role.label]);
  for (const [id, roles] of harnesses) {
    const harness = kit.harnesses[id]!;
    const bin = harness.provider.env?.SEATWORKS_AGENT_BIN;
    if (!bin) continue;
    const ok = probes.has(bin);
    checks.push({ id: `harness:${id}`, ok, detail: ok ? `${harness.label} (${bin}) is installed for ${roles.join(", ")}.` : `${harness.label} needs \`${bin}\` on PATH for ${roles.join(", ")}.` });
  }
  for (const state of Object.values(team.mcp).filter((entry) => entry.enabled)) {
    const { entry } = state;
    const users = Object.values(team.roles).filter((seat) => seat.mcp.includes(entry.id));
    if (users.length === 0) continue;
    if (entry.kind === "proxy" && entry.proxy === "semble") {
      const bin = entry.command?.[0] ?? "";
      const ok = Boolean(bin) && probes.has(bin);
      checks.push({ id: `mcp:${entry.id}`, ok, detail: ok ? `${entry.label} starts through ${bin}.` : `${entry.label} needs \`${bin}\` on PATH.` });
    } else if (entry.kind === "proxy" && entry.proxy === "intellij") {
      const url = proxyUrl(state);
      const listed = await probes.post(url, { jsonrpc: "2.0", id: 1, method: "tools/list" }, 3000);
      if (!listed.ok || !Array.isArray(listed.json?.result?.tools)) {
        checks.push({ id: `mcp:${entry.id}`, ok: false, detail: `No IDE answered at ${url}. Open the IDE with the Index MCP Server plugin, or change the port.` });
        continue;
      }
      const exposed = new Set<string>(listed.json.result.tools.map((tool: { name: string }) => tool.name));
      const needed = new Set<string>([...(entry.internalTools ?? []), ...users.flatMap((seat) => entry.tools?.[seat.role.role] ?? [])]);
      const missing = [...needed].filter((tool) => !exposed.has(tool)).sort();
      checks.push({
        id: `mcp:${entry.id}`,
        ok: missing.length === 0,
        detail: missing.length === 0 ? `The IDE at ${url} exposes every tool the team uses.` : `Switch these tools on in the IDE's Index MCP Server settings: ${missing.join(", ")}.`,
      });
    } else if (entry.server?.type === "http" && typeof entry.server.url === "string") {
      const answered = await probes.post(String(entry.server.url), { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "seatworks-doctor", version: "2" } } }, 8000);
      const ok = answered.ok && Boolean(answered.json?.result);
      checks.push({ id: `mcp:${entry.id}`, ok, detail: ok ? `${entry.label} answered.` : `${entry.label} did not answer: ${answered.error ?? "no MCP result"}.` });
    }
  }
  return checks;
}
