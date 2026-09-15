import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderPrompt } from "./content.ts";
import { loadKit } from "./kit.ts";
import { seatPairs } from "./providers.ts";
import { materialize, seatDir, seedRecords } from "./seats.ts";
import { resolveTeam, serversFor } from "./team.ts";
import { tempDir } from "./testkit.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the shipped kit resolves to a complete team, and every role's seat builds with no hidden word in it", () => {
  const kit = loadKit(pluginRoot);
  const team = resolveTeam(kit);
  assert.deepEqual(team.errors, []);
  assert.deepEqual(kit.roles.map((role) => role.role).sort(), ["lead", "peer", "reviewer", "supervisor", "watcher"]);
  assert.deepEqual(Object.keys(kit.mcp).sort(), ["code-search", "context7", "intellij-index"]);
  assert.deepEqual(seatPairs(kit).map((pair) => `${pair.role.role}-${pair.harness.id}`).sort(), ["lead-claude", "peer-devin", "reviewer-devin", "supervisor-claude"]);
  const home = tempDir("sw2-real-home-");
  const project = { slug: "demo-000000", state: "/state/demo" };
  for (const [name, seat] of Object.entries(team.roles)) {
    const { role, harness } = seat;
    const where = role.headless ? undefined : project;
    materialize(kit, team, name, home, where, serversFor(kit, team, name, { node: "/bin/node", spool: "/spool" }));
    const dir = seatDir(kit, role, harness, home, where);
    assert.ok(existsSync(join(dir, harness.skillsDir)), `${name} skills dir`);
    if (role.headless) {
      assert.equal(existsSync(join(dir, harness.promptFile ?? "AGENTS.md")), false, `${name} runs headless with no seat prompt`);
      assert.deepEqual(JSON.parse(readFileSync(join(dir, harness.mcp.file), "utf-8")).mcpServers, {}, `${name} has no MCP servers`);
      continue;
    }
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
