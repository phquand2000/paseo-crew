import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentConfig, type SessionOpen, applyRole, seatEnv } from "./launch.ts";
import { makeKit } from "./testkit.ts";

const kit = makeKit();
const render = () => "ROLE PROMPT";

test("a Lead gets its default model for an unknown alias, its mode, thinking and prompt", () => {
  const config = { provider: "sw2-lead", cwd: "/repo", model: "made-up", modeId: "default" } as AgentConfig;
  const next = applyRole(kit, config, render);
  assert.equal(next.model, "opus");
  assert.equal(next.modeId, "bypassPermissions");
  assert.equal(next.thinkingOptionId, "medium");
  assert.equal(next.systemPrompt, "ROLE PROMPT");
});

test("a valid model and thinking option are kept and a caller prompt is appended", () => {
  const config = { provider: "sw2-supervisor", cwd: "/repo", model: "opus", thinkingOptionId: "medium", systemPrompt: "extra" } as AgentConfig;
  const next = applyRole(kit, config, render);
  assert.equal(next.thinkingOptionId, "medium");
  assert.equal(next.systemPrompt, "ROLE PROMPT\n\nextra");
});

test("a Devin Peer gets no thinking option and no system prompt", () => {
  const config = { provider: "sw2-peer", cwd: "/repo", thinkingOptionId: "high" } as AgentConfig;
  const next = applyRole(kit, config, render);
  assert.equal(next.model, "swe");
  assert.equal(next.modeId, "bypass");
  assert.equal("thinkingOptionId" in next, false);
  assert.equal(next.systemPrompt, undefined);
});

test("a Claude seat may write its project's state through the sandbox, keeping existing options", () => {
  const config = { provider: "sw2-lead", cwd: "/repo", providerOptions: { disallowedTools: ["X"], settings: { sandbox: { filesystem: { allowWrite: ["/tmp"] } } } } } as unknown as AgentConfig;
  const next = applyRole(kit, config, render, "/state/repo") as unknown as { providerOptions: any };
  assert.deepEqual(next.providerOptions.disallowedTools, ["X"]);
  assert.deepEqual(next.providerOptions.settings.sandbox.filesystem.allowWrite, ["/tmp", "/state/repo"]);
  const peer = applyRole(kit, { provider: "sw2-peer", cwd: "/repo" } as AgentConfig, render, "/state/repo");
  assert.equal(peer.providerOptions, undefined);
});

test("a Claude seat gets the team server in its launch config", () => {
  const config = { provider: "sw2-lead", cwd: "/repo", mcpServers: { other: { type: "stdio", command: "x" } } } as unknown as AgentConfig;
  const team = { team: { type: "stdio", command: "node", args: ["team.mjs", "lead", "/spool"] } };
  const next = applyRole(kit, config, render, undefined, team) as unknown as { mcpServers: Record<string, unknown> };
  assert.deepEqual(Object.keys(next.mcpServers).sort(), ["other", "team"]);
  const peer = applyRole(kit, { provider: "sw2-peer", cwd: "/repo" } as AgentConfig, render, undefined, team);
  assert.equal(peer.mcpServers, undefined);
});

test("providers outside the kit are left untouched", () => {
  const config = { provider: "claude", cwd: "/repo", model: "x" } as AgentConfig;
  assert.equal(applyRole(kit, config, render), config);
});

test("a seat's session gets its config directory and project variables", () => {
  const request = { agentId: "a", workspaceId: null, provider: "sw2-peer", cwd: "/repo", reason: "create", purpose: "interactive", env: { KEEP: "1" } } as SessionOpen;
  const next = seatEnv(kit, request, (role) => `/seats/${role.role}`, { root: "/repo", state: "/state/repo" });
  assert.deepEqual(next.env, {
    KEEP: "1",
    XDG_CONFIG_HOME: "/seats/peer",
    SEATWORKS_ROLE: "peer",
    SEATWORKS_PROJECT: "/repo",
    SEATWORKS_STATE: "/state/repo",
  });
});
