import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentConfig, type SessionOpen, applyRole, seatEnv } from "./launch.ts";
import { resolveTeam } from "./team.ts";
import { makeKit } from "./testkit.ts";

const kit = makeKit();
const team = resolveTeam(kit);
const render = () => "ROLE PROMPT";

test("a Lead gets the model its settings choose for an unknown alias, its mode, thinking and prompt", () => {
  const config = { provider: "sw2-lead-claude", cwd: "/repo", model: "made-up", modeId: "default" } as AgentConfig;
  const next = applyRole(kit, team, config, render);
  assert.equal(next.model, "opus");
  assert.equal(next.modeId, "bypassPermissions");
  assert.equal(next.thinkingOptionId, "medium");
  assert.equal(next.systemPrompt, "ROLE PROMPT");
  const high = applyRole(kit, resolveTeam(kit, { roles: { lead: { thinking: "high" } } }), config, render);
  assert.equal(high.thinkingOptionId, "high");
});

test("a valid model and thinking option are kept and a caller prompt is appended", () => {
  const config = { provider: "sw2-supervisor-claude/opus", cwd: "/repo", model: "opus", thinkingOptionId: "medium", systemPrompt: "extra" } as AgentConfig;
  const next = applyRole(kit, team, config, render);
  assert.equal(next.thinkingOptionId, "medium");
  assert.equal(next.systemPrompt, "ROLE PROMPT\n\nextra");
});

test("a Devin Peer gets no thinking option and no system prompt", () => {
  const config = { provider: "sw2-peer-devin", cwd: "/repo", thinkingOptionId: "high" } as AgentConfig;
  const next = applyRole(kit, team, config, render);
  assert.equal(next.model, "swe");
  assert.equal(next.modeId, "bypass");
  assert.equal("thinkingOptionId" in next, false);
  assert.equal(next.systemPrompt, undefined);
});

test("a Lead opened on Devin follows that harness, whatever the settings choose", () => {
  const next = applyRole(kit, team, { provider: "sw2-lead-devin", cwd: "/repo", model: "opus" } as AgentConfig, render);
  assert.equal(next.model, "swe");
  assert.equal(next.modeId, "bypass");
  assert.equal(next.systemPrompt, undefined);
});

test("a Claude seat may write its project's state through the sandbox, keeping existing options", () => {
  const config = { provider: "sw2-lead-claude", cwd: "/repo", providerOptions: { disallowedTools: ["X"], settings: { sandbox: { filesystem: { allowWrite: ["/tmp"] } } } } } as unknown as AgentConfig;
  const next = applyRole(kit, team, config, render, "/state/repo") as unknown as { providerOptions: any };
  assert.deepEqual(next.providerOptions.disallowedTools, ["X"]);
  assert.deepEqual(next.providerOptions.settings.sandbox.filesystem.allowWrite, ["/tmp", "/state/repo"]);
  const peer = applyRole(kit, team, { provider: "sw2-peer-devin", cwd: "/repo" } as AgentConfig, render, "/state/repo");
  assert.equal(peer.providerOptions, undefined);
});

test("a harness that takes MCP servers at launch gets them in the launch config; one that reads a file does not", () => {
  const config = { provider: "sw2-lead-claude", cwd: "/repo", mcpServers: { other: { type: "stdio", command: "x" } } } as unknown as AgentConfig;
  const servers = { team: { type: "stdio", command: "node", args: ["team.mjs", "lead", "/spool"] } };
  const next = applyRole(kit, team, config, render, undefined, servers) as unknown as { mcpServers: Record<string, unknown> };
  assert.deepEqual(Object.keys(next.mcpServers).sort(), ["other", "team"]);
  const peer = applyRole(kit, team, { provider: "sw2-peer-devin", cwd: "/repo" } as AgentConfig, render, undefined, servers);
  assert.equal(peer.mcpServers, undefined);
});

test("providers outside the kit are left untouched", () => {
  const config = { provider: "claude", cwd: "/repo", model: "x" } as AgentConfig;
  assert.equal(applyRole(kit, team, config, render), config);
  assert.equal(applyRole(kit, team, { provider: "sw2-lead", cwd: "/repo" } as AgentConfig, render).model, undefined);
});

test("a seat's session gets its config directory and project variables", () => {
  const request = { agentId: "a", workspaceId: null, provider: "sw2-peer-devin", cwd: "/repo", reason: "create", purpose: "interactive", env: { KEEP: "1" } } as SessionOpen;
  const next = seatEnv(kit, request, "/seats/peer-devin-repo", { root: "/repo", state: "/state/repo" });
  assert.deepEqual(next.env, {
    KEEP: "1",
    XDG_CONFIG_HOME: "/seats/peer-devin-repo",
    SEATWORKS_ROLE: "peer",
    SEATWORKS_PROJECT: "/repo",
    SEATWORKS_STATE: "/state/repo",
  });
});

test("a seat keeps its own harness's model and thinking when the settings put that role on another harness", () => {
  const onDevin = resolveTeam(kit, { roles: { lead: { harness: "devin", model: "swe" } } });
  assert.equal(onDevin.roles.lead!.harness.id, "devin");
  const devinSeat = applyRole(kit, onDevin, { provider: "sw2-lead-devin", cwd: "/repo" } as AgentConfig, render);
  assert.equal(devinSeat.model, "swe");
  const claudeSeat = applyRole(kit, onDevin, { provider: "sw2-lead-claude", cwd: "/repo" } as AgentConfig, render);
  assert.equal(claudeSeat.model, "opus");
  assert.equal(claudeSeat.thinkingOptionId, "medium");
  assert.equal(applyRole(kit, onDevin, { provider: "sw2-lead-claude", cwd: "/repo", model: "haiku" } as AgentConfig, render).model, "haiku");
});
