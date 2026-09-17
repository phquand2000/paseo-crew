import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { parse } from "smol-toml";
import { loadKit } from "../../server/catalog/kit.ts";
import { composeSettings, materialize, seatDir } from "../../server/catalog/seats.ts";
import { resolveTeam, serversFor } from "../../server/catalog/team.ts";
import { makeKit } from "../../server/catalog/testkit.ts";
import { tempDir } from "../../server/core/testing.ts";

const project = { slug: "shop-abc123", state: "/state/shop" };
const context = { node: "/bin/node", spool: "/spool" };

test("a Claude seat per project writes shared plus role settings, links skills, clears MCP files and writes the rules to CLAUDE.md", () => {
  const kit = makeKit();
  const team = resolveTeam(kit);
  const home = tempDir("sw2-home-");
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  const lead = team.roles.lead!;
  const dir = seatDir(kit, lead.role, lead.harness, home, project);
  assert.equal(basename(dir), "sw2-lead-claude-shop-abc123");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".claude.json"), JSON.stringify({ userID: "u", mcpServers: { old: {} }, enableAllProjectMcpServers: true, projects: { "/x": { mcpServers: { rogue: {} }, trust: true } } }));
  symlinkSync(join(kit.dir, "harness/claude/settings/lead.settings.json"), join(dir, "settings.json"));

  const changes = materialize(kit, team, "lead", home, project, serversFor(kit, team, "lead", context));
  assert.ok(changes.length > 0);
  assert.equal(lstatSync(join(dir, "settings.json")).isSymbolicLink(), false);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf-8")), { autoMemoryEnabled: false, permissions: { deny: ["WebSearch", "Agent"] } });
  assert.equal(readlinkSync(join(dir, "projects")), join(home, ".claude", "projects"));
  assert.equal(readlinkSync(join(dir, "skills", "ide-guide")), join(kit.dir, "catalog/mcp/ide/skills/ide-guide"));
  const state = JSON.parse(readFileSync(join(dir, ".claude.json"), "utf-8"));
  assert.deepEqual(state.mcpServers, {});
  assert.equal(state.userID, "u");
  assert.equal("enableAllProjectMcpServers" in state, false);
  assert.deepEqual(state.projects["/x"], { mcpServers: {}, trust: true });
  const rules = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
  assert.match(rules, /Prefer the IDE for navigation\./);
  assert.match(rules, /Your IDE tools: `ide_find_references`\./);
  assert.deepEqual(materialize(kit, team, "lead", home, project, serversFor(kit, team, "lead", context)), []);

  const off = resolveTeam(kit, { mcp: { ide: { enabled: false } } });
  const removed = materialize(kit, off, "lead", home, project, serversFor(kit, off, "lead", context));
  assert.ok(removed.includes("CLAUDE.md removed"));
  assert.ok(removed.includes("skill ide-guide removed"));
  assert.equal(existsSync(join(dir, "CLAUDE.md")), false);
});

test("a Devin seat merges settings, writes its MCP file and a real prompt with the rules appended", () => {
  const kit = makeKit();
  const team = resolveTeam(kit, { mcp: { docs: { enabled: true } } });
  const home = tempDir("sw2-home-");
  const peer = team.roles.peer!;
  const dir = seatDir(kit, peer.role, peer.harness, home, project);
  mkdirSync(join(dir, "devin"), { recursive: true });
  writeFileSync(join(dir, "devin", "config.json"), JSON.stringify({ version: 3, permissions: { allow: ["Exec(rm)"] } }));
  const outside = join(tempDir("sw2-outside-"), "PEER.md");
  writeFileSync(outside, "project prompt that must not change");
  symlinkSync(outside, join(dir, "devin", "AGENTS.md"));

  materialize(kit, team, "peer", home, project, serversFor(kit, team, "peer", context));
  const config = JSON.parse(readFileSync(join(dir, "devin", "config.json"), "utf-8"));
  assert.equal(config.version, 3);
  assert.equal(config.notify, "never");
  assert.deepEqual(config.permissions, { deny: ["Exec(git push)"] });
  const prompt = join(dir, "devin", "AGENTS.md");
  assert.equal(lstatSync(prompt).isSymbolicLink(), false);
  const text = readFileSync(prompt, "utf-8");
  assert.match(text, /^# Peer/);
  assert.match(text, /# Working rules/);
  assert.match(text, /Look library APIs up in the docs\./);
  assert.equal(readFileSync(outside, "utf-8"), "project prompt that must not change");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, "devin", "mcp_config.json"), "utf-8")).mcpServers).sort(), ["docs", "ide", "team"]);
  for (const skill of ["test-first", "plan-check", "ide-guide"]) assert.ok(existsSync(join(dir, "devin", "skills", skill, "SKILL.md")), skill);
  assert.equal(existsSync(join(dir, "git")), false);
});

test("a prompt carrying a word its role must not see is refused", () => {
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  writeFileSync(join(kit.dir, "content/prompts/PEER.md"), "# Peer\n\nAsk the seat above you.\n");
  assert.throws(() => materialize(kit, resolveTeam(kit), "peer", home, project), /must not see: seat/);
});

test("a skill carrying a word its role must not see, or a placeholder nothing fills in, is refused", () => {
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  const skill = join(kit.dir, "content/skills/peer/test-first/SKILL.md");
  writeFileSync(skill, "---\nname: test-first\ndescription: tests\n---\n\nAsk the seat above you.\n");
  assert.throws(() => materialize(kit, resolveTeam(kit), "peer", home, project), /skill test-first shows the peer words it must not see in SKILL.md: seat/);
  writeFileSync(skill, "---\nname: test-first\ndescription: tests\n---\n\nRead {{guides}}/BRIEF.md.\n");
  assert.throws(() => materialize(kit, resolveTeam(kit), "peer", home, project), /skill test-first holds \{\{guides\}\}/);
});

test("composeSettings deletes an owned key the kit no longer sets", () => {
  assert.deepEqual(composeSettings({ a: 1, permissions: { deny: ["x"] } }, { b: 2 }, ["permissions"]), { a: 1, b: 2 });
});

test("a harness with TOML config files gets its layered settings and its MCP servers in its own shape", () => {
  const base = makeKit();
  const put = (path: string, value: unknown) => {
    mkdirSync(dirname(join(base.dir, path)), { recursive: true });
    writeFileSync(join(base.dir, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  put("harness/toml/harness.json", {
    id: "toml",
    label: "Toml CLI",
    baseProvider: "acp",
    configDirEnv: "TOML_HOME",
    profileRoot: "HOME/.toml",
    promptFile: "AGENTS.md",
    skillsDir: "skills",
    systemPrompt: "file",
    settings: { file: "config.toml", source: "settings.toml", roleSource: "settings/ROLE.settings.toml", ownedPaths: ["sandbox", "approval"] },
    models: [{ id: "m", label: "M" }],
    mcp: { file: "config.toml", delivery: "file", key: "mcp_servers", shape: { stdio: { command: "{command}", args: ["{...args}"] }, http: { url: "{url}" } }, transports: ["stdio", "http"] },
    provider: {},
  });
  put("harness/toml/settings.toml", 'sandbox = "workspace-write"\n');
  put("harness/toml/settings/peer.settings.toml", 'approval = "never"\n');
  const kit = loadKit(base.dir);
  const team = resolveTeam(kit, { roles: { peer: { harness: "toml" } }, mcp: { docs: { enabled: true } } });
  assert.deepEqual(team.errors, []);
  const home = tempDir("sw2-home-");
  const servers = serversFor(kit, team, "peer", context);
  assert.ok(materialize(kit, team, "peer", home, project, servers).length > 0);
  const dir = seatDir(kit, team.roles.peer!.role, team.roles.peer!.harness, home, project);
  const config = parse(readFileSync(join(dir, "config.toml"), "utf-8")) as Record<string, any>;
  assert.equal(config.sandbox, "workspace-write");
  assert.equal(config.approval, "never");
  // The seat is told which role it is and which tool set it holds, so two roles can share one set.
  assert.deepEqual(config.mcp_servers.team, { command: "/bin/node", args: [join(kit.dir, "mcp", "team.mjs"), "peer", "peer", "/spool"] });
  assert.deepEqual(config.mcp_servers.docs, { url: "https://docs.example/mcp" });
  assert.deepEqual(materialize(kit, team, "peer", home, project, servers), []);
});
