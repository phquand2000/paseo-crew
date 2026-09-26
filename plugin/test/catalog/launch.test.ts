import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKit, providerId } from "../../server/catalog/kit.ts";
import { applyRole, seatEnv } from "../../server/catalog/launch.ts";
import type { AgentConfig, SessionOpen } from "../../server/core/ports.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { DESK_OWNED, stateRoot } from "../../server/core/paths.ts";
import { BACKUP } from "../../server/upkeep/migrate.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

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

test("a Peer whose model lists no thinking options is given none, and still its prompt", () => {
  const config = { provider: "sw2-peer-omp", cwd: "/repo", thinkingOptionId: "high" } as AgentConfig;
  const next = applyRole(kit, team, config, render);
  assert.equal(next.model, "glm");
  assert.equal(next.modeId, "full");
  assert.equal("thinkingOptionId" in next, false);
  assert.equal(next.systemPrompt, "ROLE PROMPT");
});

test("a Lead opened on another harness follows that harness, whatever the settings choose", () => {
  const next = applyRole(kit, team, { provider: "sw2-lead-omp", cwd: "/repo", model: "opus" }, render);
  assert.equal(next.model, "glm");
  assert.equal(next.modeId, "full");
});

test("a seat's shell may write under state only what its role declares, and a role may declare none of the desk's own files", () => {
  const real = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const realTeam = resolveTeam(real);
  const sandboxed = (role: string) =>
    ({ provider: providerId(real, role, "claude"), cwd: "/repo", providerOptions: { settings: { sandbox: { filesystem: { allowWrite: ["/tmp"] } } } } }) as unknown as AgentConfig;
  const granted = (role: string): string[] => (applyRole(real, realTeam, sandboxed(role), render, "/state/repo") as unknown as { providerOptions: any }).providerOptions.settings.sandbox.filesystem.allowWrite;
  for (const role of real.roles) assert.deepEqual(granted(role.role), ["/tmp", ...(role.writes ?? []).map((entry) => join("/state/repo", entry.replace(/\/$/, "")))]);
  assert.ok(granted("lead").includes("/state/repo/ultra-review"), "the ultra-review scripts write their reports from the Lead's shell");
  assert.ok(granted("supervisor").includes("/state/repo/CONTEXT.md"), "the Supervisor writes the project's concept as the Human settles it");
  assert.ok(!granted("supervisor").includes("/state/repo/checkpoints.log"), "a record a skill reads is not one it writes");
  const writing = (writes: string[]) => () => {
    const own = tempDir("sw2-writes-");
    const shipped = JSON.parse(readFileSync(join(real.dir, "roles.json"), "utf-8")) as { roles: { role: string }[] };
    writeFileSync(join(own, "roles.json"), JSON.stringify({ ...shipped, roles: shipped.roles.map((role) => (role.role === "lead" ? { ...role, writes } : role)) }));
    return loadKit(real.dir, own);
  };
  assert.throws(writing(["gates/"]), /lead writes gates, which is the desk's own record/);
  assert.throws(writing(["../outside"]), /is not one file, or one folder ending in \/, under the project's state/);

  // The sandbox binds the shell only; a file tool that could rewrite project.json's gate escapes it via /bin/sh.
  const deny: string[] = JSON.parse(readFileSync(join(real.dir, "harness", "claude", "settings.json"), "utf-8")).permissions.deny;
  for (const owned of DESK_OWNED) {
    const rule = owned.includes(".") ? `Edit(${stateRoot("~")}/projects/*/${owned})` : `Edit(${stateRoot("~")}/projects/*/${owned}/**)`;
    assert.ok(deny.includes(rule), `nothing keeps a Claude seat's file tools off ${owned}`);
    if (owned.endsWith(".log")) assert.ok(deny.includes(`Edit(${stateRoot("~")}/projects/*/${owned.replace(/\.log$/, ".*.log*")})`), `nothing keeps a Claude seat's file tools off ${owned} once it rolls`);
  }
  const readDenied = (path: string) => deny.some((rule) => rule.startsWith("Read(") && matchesGlob(path, rule.slice(5, -1)));
  const backup = "settings.json.bak-20260925-120000";
  assert.ok(BACKUP.test(backup), "named as Migrate names a backup");
  // A save stages its copy as settings.json.<pid>.tmp; it and Migrate's backups hold a sensor's key as the file does.
  for (const dir of [stateRoot("~"), `${stateRoot("~")}/projects/shop-1a2b`]) {
    for (const name of ["settings.json", backup, "settings.json.4242.tmp"]) assert.ok(readDenied(`${dir}/${name}`), `a Claude seat may read ${dir}/${name}, which can hold a sensor's key`);
  }
  assert.ok(deny.includes(`Read(${stateRoot("~")}/settings.json)`), "the machine's settings are also named without a glob, the only kind Claude's sandbox keeps on Linux");

  const peer = applyRole(kit, team, { provider: "sw2-peer-omp", cwd: "/repo" }, render, "/state/repo");
  assert.equal(peer.providerOptions, undefined, "a harness that declares no write list is untouched");
});

test("a Claude seat's file tools stay off what sets up the machine's agents and the plugin, and its reads off every agent's login", () => {
  const real = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const deny: string[] = JSON.parse(readFileSync(join(real.dir, "harness", "claude", "settings.json"), "utf-8")).permissions.deny;
  const denied = (tool: "Edit" | "Read", path: string) => deny.some((rule) => rule.startsWith(`${tool}(`) && matchesGlob(path, rule.slice(tool.length + 1, -1)));
  const home = (path: string) => path.replace(/^HOME/, "~");
  for (const harness of Object.values(real.harnesses)) {
    // Another seat's settings hold that seat's own denials, and what the seats link to is the owner's.
    assert.ok(denied("Edit", `${home(harness.profileRoot)}/sw2-supervisor-${harness.id}-shop-1a2b/${harness.settings.file}`), `a Claude seat may edit ${harness.id} seats' settings`);
    for (const link of harness.links ?? []) assert.ok(denied("Edit", home(link.target)) || denied("Edit", `${home(link.target)}/x`), `a Claude seat may edit ${link.target}`);
  }
  // Every seat reads the content copies and runs the git launcher; the desk knows a caller by the key it shows.
  const machine = stateRoot("~");
  for (const path of ["intents.json", "kit.json", "content.json", "models.json", "bin/git", "keys.json", "content/grilling-09b6abde7462/SKILL.md", "guides/PLANS.md"]) {
    assert.ok(denied("Edit", `${machine}/${path}`), `a Claude seat may edit ${path} in the plugin's own state`);
  }
  for (const path of ["keys.json", "keys.json.123.tmp"]) assert.ok(denied("Read", `${machine}/${path}`), `a Claude seat may read ${path}, and show the desk another seat's key`);
  for (const login of ["~/.paseo/config.json", "~/.codex/auth.json", "~/.pi/agent/auth.json", "~/.omp/agent/agent.db", "~/.local/share/opencode/auth.json", "~/.claude/.credentials.json"]) {
    assert.ok(deny.includes(`Read(${login})`), `a Claude seat may read ${login}, a login; named without a glob, the only kind Claude's sandbox keeps on Linux`);
  }
  assert.ok(denied("Read", "~/.codex/seats/sw2-peer-codex-shop-1a2b/auth.json"), "nor through the link to it in a seat's directory");
  assert.ok(denied("Edit", "~/.gitconfig") && denied("Edit", "~/.config/git/config"), "a Claude seat may edit git's own configuration, which the desk's git reads too");
});

test("a seat is handed its own working directory where its harness reads a project's instructions from that alone", () => {
  const config = { provider: "sw2-lead-claude", cwd: "/repo", providerOptions: { additionalDirectories: ["/elsewhere"] } } as unknown as AgentConfig;
  const next = applyRole(kit, team, config, render) as unknown as { providerOptions: { additionalDirectories: string[] } };
  assert.deepEqual(next.providerOptions.additionalDirectories, ["/elsewhere", "/repo"]);
  const again = applyRole(kit, team, { ...config, providerOptions: next.providerOptions }, render) as unknown as { providerOptions: { additionalDirectories: string[] } };
  assert.deepEqual(again.providerOptions.additionalDirectories, ["/elsewhere", "/repo"], "a seat opened again is not handed its directory twice");
  const peer = applyRole(kit, team, { provider: "sw2-peer-omp", cwd: "/repo" }, render);
  assert.equal(peer.providerOptions, undefined, "a harness that reads the project on its own is left alone");
});

test("a harness that takes MCP servers at launch gets them in the launch config; one that reads a file does not", () => {
  const config = { provider: "sw2-lead-claude", cwd: "/repo", mcpServers: { other: { type: "stdio", command: "x" } } } as unknown as AgentConfig;
  const servers = { team: { type: "stdio", command: "node", args: ["team.mjs", "lead", "/spool"] } };
  const next = applyRole(kit, team, config, render, undefined, servers) as unknown as { mcpServers: Record<string, unknown> };
  assert.deepEqual(Object.keys(next.mcpServers).sort(), ["other", "team"]);
  const peer = applyRole(kit, team, { provider: "sw2-peer-omp", cwd: "/repo" }, render, undefined, servers);
  assert.equal(peer.mcpServers, undefined);
});

test("providers outside the kit are left untouched", () => {
  const config = { provider: "claude", cwd: "/repo", model: "x" } as AgentConfig;
  assert.equal(applyRole(kit, team, config, render), config);
  assert.equal(applyRole(kit, team, { provider: "sw2-lead", cwd: "/repo" }, render).model, undefined);
});

test("a seat's session gets its harness's environment, its config directory, project variables and the git launcher first on its PATH", () => {
  const request = { agentId: "a", workspaceId: null, provider: "sw2-peer-omp", cwd: "/repo", reason: "create", purpose: "interactive", env: { KEEP: "1", PATH: "/usr/bin" } } as SessionOpen;
  const next = seatEnv(kit, request, "/seats/peer-omp-repo", { root: "/repo", state: "/state/repo" }, "/state/bin");
  // Paseo may run one agent server for every seat of a harness, so only the session carries the seat's own environment.
  assert.deepEqual(next.env, {
    KEEP: "1",
    PATH: `/state/bin${delimiter}/usr/bin`,
    SEATWORKS_HARNESS: "omp",
    SEATWORKS_AGENT_BIN: "omp",
    PI_CODING_AGENT_DIR: "/seats/peer-omp-repo",
    SEATWORKS_ROLE: "peer",
    SEATWORKS_PROJECT: "/repo",
    SEATWORKS_STATE: "/state/repo",
  });
});

test("a seat keeps its own harness's model and thinking when the settings put that role on another harness", () => {
  const onOmp = resolveTeam(kit, { roles: { lead: { harness: "omp", model: "glm" } } });
  assert.equal(onOmp.roles.lead!.harness.id, "omp");
  const ompSeat = applyRole(kit, onOmp, { provider: "sw2-lead-omp", cwd: "/repo" }, render);
  assert.equal(ompSeat.model, "glm");
  const claudeSeat = applyRole(kit, onOmp, { provider: "sw2-lead-claude", cwd: "/repo" }, render);
  assert.equal(claudeSeat.model, "opus");
  assert.equal(claudeSeat.thinkingOptionId, "medium");
  assert.equal(applyRole(kit, onOmp, { provider: "sw2-lead-claude", cwd: "/repo", model: "haiku" }, render).model, "haiku");
});
