import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { composeSettings, materialize, seatDir } from "./seats.ts";
import { resolveTeam, serversFor } from "./team.ts";
import { makeKit } from "./testkit.ts";
import { tempDir } from "../core/testing.ts";

const project = { slug: "shop-abc123", state: "/state/shop" };
const context = { node: "/bin/node", spool: "/spool" };

test("a Claude seat per project links settings and skills, clears MCP files and writes the rules to CLAUDE.md", () => {
  const kit = makeKit();
  const team = resolveTeam(kit);
  const home = tempDir("sw2-home-");
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  const lead = team.roles.lead!;
  const dir = seatDir(kit, lead.role, lead.harness, home, project);
  assert.equal(basename(dir), "sw2-lead-claude-shop-abc123");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".claude.json"), JSON.stringify({ userID: "u", mcpServers: { old: {} }, enableAllProjectMcpServers: true, projects: { "/x": { mcpServers: { rogue: {} }, trust: true } } }));

  const changes = materialize(kit, team, "lead", home, project, serversFor(kit, team, "lead", context));
  assert.ok(changes.length > 0);
  assert.equal(readlinkSync(join(dir, "settings.json")), join(kit.dir, "harness/claude/settings/lead.settings.json"));
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

test("the headless watcher seat is per machine, with no prompt, no MCP servers and no rules", () => {
  const kit = makeKit();
  const team = resolveTeam(kit, { mcp: { docs: { enabled: true } } });
  const home = tempDir("sw2-home-");
  const watcher = team.roles.watcher!;
  const dir = seatDir(kit, watcher.role, watcher.harness, home);
  assert.equal(basename(dir), "sw2-watcher-devin");
  materialize(kit, team, "watcher", home, undefined, serversFor(kit, team, "watcher", context));
  assert.equal(existsSync(join(dir, "devin", "AGENTS.md")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "devin", "mcp_config.json"), "utf-8")).mcpServers, {});
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "devin", "config.json"), "utf-8")).permissions, { deny: ["exec"] });
});

test("a prompt carrying a word its role must not see is refused", () => {
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  writeFileSync(join(kit.dir, "content/prompts/PEER.md"), "# Peer\n\nAsk the seat above you.\n");
  assert.throws(() => materialize(kit, resolveTeam(kit), "peer", home, project), /must not see: seat/);
});

test("composeSettings deletes an owned key the kit no longer sets", () => {
  assert.deepEqual(composeSettings({ a: 1, permissions: { deny: ["x"] } }, { b: 2 }, ["permissions"]), { a: 1, b: 2 });
});
