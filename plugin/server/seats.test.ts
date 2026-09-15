import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { composeSettings, materialize, seatDir } from "./seats.ts";
import { makeKit, tempDir } from "./testkit.ts";

test("a Claude seat links its settings and skills and writes only the kit's MCP servers", () => {
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  const supervisor = kit.roles.find((role) => role.role === "supervisor")!;
  const dir = seatDir(kit, supervisor, home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".claude.json"), JSON.stringify({ userID: "u", enableAllProjectMcpServers: true, projects: { "/x": { mcpServers: { rogue: {} }, trust: true } } }));

  const changes = materialize(kit, supervisor, home);
  assert.ok(changes.length > 0);
  assert.equal(readlinkSync(join(dir, "settings.json")), join(kit.dir, "harness/claude/settings/supervisor.settings.json"));
  assert.equal(readlinkSync(join(dir, "projects")), join(home, ".claude", "projects"));
  assert.equal(readlinkSync(join(dir, "skills", "plan-check")), join(kit.dir, "content/skills/supervisor/plan-check"));
  const state = JSON.parse(readFileSync(join(dir, ".claude.json"), "utf-8"));
  assert.deepEqual(Object.keys(state.mcpServers).sort(), ["designs", "search"]);
  assert.equal(state.userID, "u");
  assert.equal("enableAllProjectMcpServers" in state, false);
  assert.deepEqual(state.projects["/x"], { mcpServers: {}, trust: true });
  assert.deepEqual(materialize(kit, supervisor, home), []);
});

test("a Devin seat merges settings, replaces owned keys whole and writes a real prompt file", () => {
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  const peer = kit.roles.find((role) => role.role === "peer")!;
  const dir = seatDir(kit, peer, home);
  mkdirSync(join(dir, "devin"), { recursive: true });
  writeFileSync(join(dir, "devin", "config.json"), JSON.stringify({ version: 3, permissions: { allow: ["Exec(rm)"] } }));
  const outside = join(tempDir("sw2-outside-"), "PEER.md");
  writeFileSync(outside, "project prompt that must not change");
  symlinkSync(outside, join(dir, "devin", "AGENTS.md"));

  materialize(kit, peer, home);
  const config = JSON.parse(readFileSync(join(dir, "devin", "config.json"), "utf-8"));
  assert.equal(config.version, 3);
  assert.equal(config.notify, "never");
  assert.deepEqual(config.permissions, { deny: ["Exec(git push)"] });
  assert.equal(lstatSync(join(dir, "devin", "AGENTS.md")).isSymbolicLink(), false);
  assert.match(readFileSync(join(dir, "devin", "AGENTS.md"), "utf-8"), /^# Peer/);
  assert.equal(readFileSync(outside, "utf-8"), "project prompt that must not change");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, "devin", "mcp_config.json"), "utf-8")).mcpServers), ["search"]);
  assert.ok(existsSync(join(dir, "devin", "skills", "test-first", "SKILL.md")));
  assert.ok(existsSync(join(dir, "devin", "skills", "plan-check", "SKILL.md")));
  assert.equal(existsSync(join(dir, "git")), false);
});

test("a prompt carrying a word its role must not see is refused", () => {
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  const peer = kit.roles.find((role) => role.role === "peer")!;
  writeFileSync(join(kit.dir, "content/prompts/PEER.md"), "# Peer\n\nAsk the seat above you.\n");
  assert.throws(() => materialize(kit, peer, home), /must not see: seat/);
});

test("composeSettings deletes an owned key the kit no longer sets", () => {
  assert.deepEqual(composeSettings({ a: 1, permissions: { deny: ["x"] } }, { b: 2 }, ["permissions"]), { a: 1, b: 2 });
});
