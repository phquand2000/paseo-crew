import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DESK_OWNED, skillSources } from "../../server/catalog/content.ts";
import { loadKit, providerId } from "../../server/catalog/kit.ts";
import { type AgentConfig, type SessionOpen, applyRole, seatEnv } from "../../server/catalog/launch.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { makeKit } from "../../server/catalog/testkit.ts";

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

test("a seat's shell may write every place under state its own content names, and none of the desk's own files", () => {
  // The shipped kit, because the grant is derived from the shipped prompts and skills.
  const real = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const realTeam = resolveTeam(real);
  const sandboxed = (role: string) =>
    ({ provider: providerId(real, role, "claude"), cwd: "/repo", providerOptions: { settings: { sandbox: { filesystem: { allowWrite: ["/tmp"] } } } } }) as unknown as AgentConfig;
  const granted = (role: string): string[] => (applyRole(real, realTeam, sandboxed(role), render, "/state/repo") as unknown as { providerOptions: any }).providerOptions.settings.sandbox.filesystem.allowWrite;
  const named = (role: string): string[] => {
    const spec = real.roles.find((entry) => entry.role === role)!;
    const texts = [readFileSync(join(real.dir, "content", spec.prompt), "utf-8")];
    for (const dir of skillSources(real, spec).values()) for (const file of readdirSync(dir, { recursive: true }).map(String).filter((name) => name.endsWith(".md"))) texts.push(readFileSync(join(dir, file), "utf-8"));
    return [...new Set(texts.flatMap((text) => [...text.matchAll(/(?:\{\{state\}\}|\$SEATWORKS_STATE)\/([A-Za-z0-9_.-]+)/g)].map((match) => match[1]!)))];
  };

  // The first narrowing named the two places the prompts mention and nothing else, while the skills
  // in the same seats run scripts that write under ultra-review/, council/, repo-refresh/ and
  // pre-mortem/ — every one of which the sandboxed shell then refused. This asserted that list.
  for (const role of real.roles.map((entry) => entry.role)) {
    const paths = granted(role);
    for (const segment of named(role).filter((name) => !DESK_OWNED.has(name))) {
      assert.ok(paths.includes(`/state/repo/${segment}`), `the ${role}'s own content tells it to write ${segment}, and its shell may not`);
    }
    for (const owned of DESK_OWNED) assert.ok(!paths.includes(`/state/repo/${owned}`), `the ${role} was given the desk's own ${owned}`);
  }
  assert.ok(granted("lead").includes("/state/repo/ultra-review"));
  assert.ok(granted("lead").includes("/state/repo/docs"), "the directive tells the Lead to keep the project's pages current");

  // The sandbox binds the shell only. project.json's gate runs through /bin/sh in the daemon, so a
  // file tool that could rewrite it was the way out of the sandbox the grant above exists to keep.
  const deny: string[] = JSON.parse(readFileSync(join(real.dir, "harness", "claude", "settings.json"), "utf-8")).permissions.deny;
  for (const owned of DESK_OWNED) {
    const rule = owned.includes(".") ? `Edit(~/.local/share/seatworks-v2/projects/*/${owned})` : `Edit(~/.local/share/seatworks-v2/projects/*/${owned}/**)`;
    assert.ok(deny.includes(rule), `nothing keeps a Claude seat's file tools off ${owned}`);
  }

  const peer = applyRole(kit, team, { provider: "sw2-peer-devin", cwd: "/repo" } as AgentConfig, render, "/state/repo");
  assert.equal(peer.providerOptions, undefined, "a harness that declares no write list is untouched");
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
