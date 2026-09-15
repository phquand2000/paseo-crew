import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderPrompt } from "./content.ts";
import { harnessOf, loadKit } from "./kit.ts";
import { materialize, seatDir, seedRecords } from "./seats.ts";
import { tempDir } from "./testkit.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the shipped kit loads, and every role's seat builds with no hidden word in its prompt", () => {
  const kit = loadKit(pluginRoot);
  const home = tempDir("sw2-real-home-");
  assert.deepEqual(
    kit.roles.map((role) => role.role).sort(),
    ["lead", "peer", "reviewer", "supervisor", "watcher"],
  );
  for (const role of kit.roles) {
    const harness = harnessOf(kit, role);
    materialize(kit, role, home);
    const dir = seatDir(kit, role, home);
    assert.ok(existsSync(join(dir, harness.skillsDir)), `${role.role} skills dir`);
    if (role.headless) {
      assert.equal(existsSync(join(dir, harness.promptFile ?? "AGENTS.md")), false, `${role.role} runs headless with no seat prompt`);
      assert.deepEqual(JSON.parse(readFileSync(join(dir, harness.state!.file), "utf-8")).mcpServers, {}, `${role.role} has no MCP servers`);
    } else if (harness.systemPrompt === "file" && harness.promptFile) {
      const file = join(dir, harness.promptFile);
      assert.equal(lstatSync(file).isSymbolicLink(), false, `${role.role} prompt is a real file`);
      assert.doesNotMatch(readFileSync(file, "utf-8"), /\{\{/, `${role.role} prompt has no placeholder left`);
    } else {
      const prompt = renderPrompt(kit, role, { guides: join(home, ".local/share/seatworks-v2/guides"), state: "/state" });
      assert.doesNotMatch(prompt, /\{\{/, `${role.role} prompt has no placeholder left`);
    }
  }
});

test("project records are seeded once and never overwritten", () => {
  const kit = loadKit(pluginRoot);
  const state = tempDir("sw2-state-");
  const first = seedRecords(kit, state);
  assert.ok(first.includes("notebook.md"));
  assert.deepEqual(seedRecords(kit, state), []);
});
