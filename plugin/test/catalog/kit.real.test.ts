import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderPrompt } from "../../server/catalog/content.ts";
import { PASEO_TOOLS, loadKit } from "../../server/catalog/kit.ts";
import { desiredProvider, seatPairs } from "../../server/catalog/providers.ts";
import { materialize, seatDir, seedRecords } from "../../server/catalog/seats.ts";
import { resolveTeam, serversFor } from "../../server/catalog/team.ts";
import { tempDir } from "../../server/core/testing.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the shipped kit resolves to a complete team, and every role's seat builds with no hidden word in it", () => {
  const kit = loadKit(pluginRoot);
  const off = resolveTeam(kit);
  assert.deepEqual(off.errors, []);
  assert.deepEqual(Object.values(off.mcp).filter((state) => state.enabled), [], "the kit ships no server switched on");
  const team = resolveTeam(kit, { mcp: Object.fromEntries(Object.keys(kit.mcp).map((id) => [id, { enabled: true }])) });
  assert.deepEqual(team.errors, []);
  assert.deepEqual(kit.roles.map((role) => role.role).sort(), ["lead", "peer", "reviewer", "supervisor", "watcher"]);
  assert.deepEqual(Object.keys(kit.mcp).sort(), ["code-search", "context7", "intellij-index"]);
  assert.deepEqual(seatPairs(kit).map((pair) => `${pair.role.role}-${pair.harness.id}`).sort(), ["lead-claude", "peer-claude", "peer-devin", "reviewer-claude", "reviewer-devin", "supervisor-claude", "watcher-devin"]);
  const home = tempDir("sw2-real-home-");
  const project = { slug: "demo-000000", state: "/state/demo" };
  for (const [name, seat] of Object.entries(team.roles)) {
    const { role, harness } = seat;
    const where = project;
    materialize(kit, team, name, home, where, serversFor(kit, team, name, { node: "/bin/node", spool: "/spool" }));
    const dir = seatDir(kit, role, harness, home, where);
    assert.ok(existsSync(join(dir, harness.skillsDir)), `${name} skills dir`);
    let context: string;
    if (harness.systemPrompt === "file" && harness.promptFile) {
      const file = join(dir, harness.promptFile);
      assert.equal(lstatSync(file).isSymbolicLink(), false, `${name} prompt is a real file`);
      context = readFileSync(file, "utf-8");
    } else {
      assert.doesNotMatch(renderPrompt(kit, role, { guides: "/guides", state: "/state" }), /\{\{/, `${name} prompt has no placeholder left`);
      context = readFileSync(join(dir, harness.contextFile!), "utf-8");
    }
    assert.doesNotMatch(context, /\{\{/, `${name} seat has no placeholder left`);
    if (seat.mcp.length === 0) {
      assert.doesNotMatch(context, /intellij-index MCP tools/, `${name} takes no server, so it carries no server rule`);
      assert.equal(existsSync(join(dir, harness.skillsDir, "ide-index-mcp", "SKILL.md")), false, `${name} takes no server, so it has no IDE skill`);
      continue;
    }
    assert.match(context, /intellij-index MCP tools/, `${name} seat carries the IntelliJ rule`);
    assert.match(context, /context7/, `${name} seat carries the docs rule`);
    assert.ok(existsSync(join(dir, harness.skillsDir, "ide-index-mcp", "SKILL.md")), `${name} has the IDE skill`);
  }
});

test("project records are seeded once and never overwritten", () => {
  const kit = loadKit(pluginRoot);
  const state = tempDir("sw2-state-");
  const first = seedRecords(kit, state);
  assert.ok(first.includes("notebook.md"));
  assert.deepEqual(seedRecords(kit, state), []);
});

test("no shipped role is left with Paseo's own tools at their default", () => {
  const kit = loadKit(pluginRoot);
  const team = resolveTeam(kit);
  for (const { role, harness } of seatPairs(kit)) {
    const entry = desiredProvider(kit, team, role, harness);
    assert.ok(entry.paseoTools, `${role.role} on ${harness.id} carries no Paseo tool policy, so every Paseo tool stays on`);
  }
  const watcher = kit.roles.find((role) => role.role === "watcher")!;
  const policy = desiredProvider(kit, team, watcher, kit.harnesses.devin!).paseoTools as { disabledTools: string[] };
  assert.deepEqual(
    PASEO_TOOLS.filter((tool) => !policy.disabledTools.includes(tool)).sort(),
    ["get_agent_activity", "list_agents"],
    "the Watcher reads what the other seats did, and that is the whole of its reach",
  );
  for (const acting of ["create_agent", "kill_agent", "archive_agent", "send_agent_prompt", "cancel_agent", "update_agent", "respond_to_permission"]) {
    assert.ok(policy.disabledTools.includes(acting), `the Watcher watches the work and must not be able to ${acting}`);
  }
});

test("the Supervisor can set its own cadence for reading the work, rather than the desk fixing one", () => {
  const kit = loadKit(pluginRoot);
  const team = resolveTeam(kit);
  const supervisor = kit.roles.find((role) => role.role === "supervisor")!;
  const policy = desiredProvider(kit, team, supervisor, kit.harnesses.claude!).paseoTools as { disabledTools: string[] };
  for (const own of ["create_heartbeat", "delete_heartbeat", "list_schedules"]) {
    assert.ok(!policy.disabledTools.includes(own), `a heartbeat is how a Supervisor decides when to look, so it must reach ${own}`);
  }
  for (const acting of ["create_agent", "kill_agent", "send_agent_prompt", "archive_agent"]) {
    assert.ok(policy.disabledTools.includes(acting), `the Supervisor advises and must not ${acting} behind the desk`);
  }
});

test("every page the kit puts on the shelf says what it owns, when to take it, and when it is ceremony", () => {
  const kit = loadKit(pluginRoot);
  const names = Object.keys(kit.templates).sort();
  assert.ok(names.length >= 10, `the shelf is worth having only if there is a choice on it: ${names.join(", ")}`);
  for (const name of names) {
    const spec = kit.templates[name]!;
    for (const field of ["owns", "prevents", "activate", "ceremony"] as const) {
      assert.ok(spec[field].length > 0, `${name} does not say its ${field}, so nobody can judge whether to keep it`);
    }
    assert.match(spec.body, /^# /m, `${name} has no heading to start from`);
    assert.doesNotMatch(spec.body, /\{\{/, `${name} holds a placeholder nothing fills in`);
  }
  // The measured finding this shelf is built on: a page that restates the repository costs context and buys nothing.
  for (const name of names) {
    assert.doesNotMatch(kit.templates[name]!.body, /directory tree|architecture overview|dependency list/i, `${name} asks for something measured not to help`);
  }
});
