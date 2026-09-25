import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PaseoHost } from "../../server/adapters/paseo/host.ts";
import type { AgentConfig, HostHooks } from "../../server/core/ports.ts";

test("before the daemon hands the plugin its handle, seats and workspaces cannot be listed, rather than listed as none", async () => {
  const host = new PaseoHost();
  await assert.rejects(host.seats.open(), /has not reached this plugin/);
  await assert.rejects(host.workspaces.owned("shop-1a2b"), /has not reached this plugin/);
});

test("what the plugin sets as a seat is created goes back to Paseo: its config and its env", async () => {
  type Before = (input: { request: Record<string, unknown> }, context: { paseo: unknown }) => Record<string, unknown>;
  const befores = new Map<string, Before>();
  const server = { before: (name: string, handler: Before) => befores.set(name, handler), on: () => () => {}, handle: () => {} } as unknown as PluginServerContext;
  const hooks = { create: (config: AgentConfig, env: Record<string, string>) => ({ config: { ...config, model: "m" }, env: { ...env, SEATWORKS_DESK_KEY: "k" } }) } as unknown as HostHooks;
  new PaseoHost().connect(server, hooks);
  const made = befores.get("agent.create")!({ request: { config: { provider: "sw2-lead-claude", cwd: "/work" }, env: { KEPT: "yes" } } }, { paseo: {} });
  assert.deepEqual(made.env, { KEPT: "yes", SEATWORKS_DESK_KEY: "k" });
  assert.equal((made.config as AgentConfig).model, "m");
});

test("Paseo's API reaches the host with any hook or panel call, and what waits for it goes on then", async () => {
  type Handler = (input: unknown, context: { paseo: unknown }) => unknown;
  const settled = (host: PaseoHost) => Promise.race([host.reached().then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20))]);
  const hooked = (host: PaseoHost, kind: "before" | "on", name: string, hooks: Partial<HostHooks>) => {
    const handlers = new Map<string, Handler>();
    const register = (named: string, handler: Handler) => void handlers.set(named, handler);
    host.connect({ before: kind === "before" ? register : () => {}, on: kind === "on" ? register : () => {} } as unknown as PluginServerContext, hooks as HostHooks);
    void handlers.get(name)!({ request: {}, agent: {} }, { paseo: {} });
  };
  const ways: [string, (host: PaseoHost) => void][] = [
    ["a hook before a seat is created", (host) => hooked(host, "before", "agent.create", { create: (config, env) => ({ config, env }) })],
    ["a hook before a session opens", (host) => hooked(host, "before", "agent.session_open", { sessionOpen: (request) => request })],
    ["a hook on a turn", (host) => hooked(host, "on", "agent.turn_started", { turnStarted: async () => {} })],
    ["a panel call", (host) => host.answering({ handle: (_contract: unknown, handler: Handler) => handler(undefined, { paseo: {} }) } as never)({ name: "status" }, () => undefined)],
  ];
  for (const [how, hand] of ways) {
    const host = new PaseoHost();
    assert.equal(await settled(host), false, `nothing has reached the host before ${how}`);
    hand(host);
    assert.equal(await settled(host), true, how);
  }
  assert.equal(await settled(new PaseoHost({} as never)), true, "a host made with the API has it at once");
});
