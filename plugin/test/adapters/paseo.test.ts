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
