import assert from "node:assert/strict";
import { test } from "node:test";
import { type Probes, doctor } from "../../server/runtime/doctor.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TeamSource } from "../../server/runtime/team-source.ts";
import { home, stateRoot } from "../../server/core/paths.ts";
import { tempDir } from "../tempdir.ts";
import { makeKit } from "../kit.ts";

const kit = makeKit();

function probes(bins: string[], tools: string[] | null, docsUp = true, paths: string[] = [join(home(), ".devin", "credentials.toml")]): Probes {
  return {
    has: (bin) => bins.includes(bin),
    exists: (path) => paths.includes(path),
    async post(url) {
      if (url.includes("127.0.0.1")) return tools ? { ok: true, json: { result: { tools: tools.map((name) => ({ name })) } } } : { ok: false, error: "refused" };
      return docsUp ? { ok: true, json: { result: {} } } : { ok: false, error: "timeout" };
    },
  };
}

test("doctor names what a machine is missing for the chosen team", async () => {
  const team = resolveTeam(kit, { mcp: { docs: { enabled: true } } });
  const checks = await doctor(kit, team, probes(["git", "claude"], ["ide_find_references", "ide_open_project"], false));
  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  assert.equal(byId.settings!.ok, true);
  assert.equal(byId["bin:jq"]!.ok, false);
  assert.equal(byId["harness:claude"]!.ok, true);
  assert.equal(byId["harness:devin"]!.ok, false);
  assert.equal(byId["mcp:ide"]!.ok, false);
  assert.match(byId["mcp:ide"]!.detail, /ide_refactor_rename/);
  assert.equal(byId["mcp:docs"]!.ok, false);
});

test("doctor passes a machine that has everything, and skips servers nobody uses", async () => {
  const team = resolveTeam(kit);
  const checks = await doctor(kit, team, probes(["git", "jq", "claude", "devin"], ["ide_find_references", "ide_refactor_rename", "ide_open_project"]));
  assert.ok(checks.every((check) => check.ok), JSON.stringify(checks));
  assert.equal(checks.some((check) => check.id === "mcp:docs"), false);
  const down = await doctor(kit, team, probes(["git", "jq", "claude", "devin"], null));
  assert.match(down.find((check) => check.id === "mcp:ide")!.detail, /No IDE server answered/);
});

test("what a harness says its seats need on this machine is checked, and how to get it is said", async () => {
  const team = resolveTeam(kit);
  const missing = await doctor(kit, team, probes(["git", "jq", "claude", "devin"], ["ide_find_references", "ide_refactor_rename", "ide_open_project"], true, []));
  const check = missing.find((entry) => entry.id === "harness:devin:HOME/.devin/credentials.toml")!;
  assert.equal(check.ok, false);
  assert.match(check.detail, /credentials\.toml for Peer, Scribe\. Log in to Devin once/);
  const present = await doctor(kit, team, probes(["git", "jq", "claude", "devin"], ["ide_find_references", "ide_refactor_rename", "ide_open_project"]));
  assert.equal(present.find((entry) => entry.id === "harness:devin:HOME/.devin/credentials.toml")!.ok, true);
});

test("a malformed answer from one server costs that server's check, not the whole report", async () => {
  const team = resolveTeam(kit, { mcp: { docs: { enabled: true } } });
  // What an outside server answers is data. A null in its tools list used to throw out of the report
  // and take the settings, git and harness checks — computed before it — with the exception.
  const hostile: Probes = {
    has: (bin) => ["git", "jq", "claude"].includes(bin),
    exists: () => true,
    async post(url) {
      if (url.includes("127.0.0.1")) return { ok: true, json: { result: { tools: [null, { name: "ide_open_project" }, "ide_find_references", { name: 7 }] } } };
      return { ok: true, json: { result: {} } };
    },
  };
  const checks = await doctor(kit, team, hostile);
  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  assert.equal(byId.settings!.ok, true, "the checks that have nothing to do with that server still arrive");
  assert.equal(byId["mcp:ide"]!.ok, false);
  assert.match(byId["mcp:ide"]!.detail, /doesn't expose/, "and the entries it could read are the ones counted");
  assert.equal(byId["mcp:docs"]!.ok, true);
});

test("settings that could not be read are not a team the owner wrote, and the doctor says so", () => {
  const home = tempDir("sw2-coldsettings-");
  const state = stateRoot(home);
  mkdirSync(state, { recursive: true });
  // The commonest hand edit there is. Before, every consumer turned this into `{}`, which cannot be
  // told apart from an owner who chose nothing: the kit's defaults resolved, and the doctor reported a
  // complete team none of whose settings were the owner's.
  writeFileSync(join(state, "settings.json"), '{ "rules": "Keep diffs small.", }');
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    const team = new TeamSource(kit).teamFor();
    assert.ok(
      team.errors.some((line) => line.includes("machine settings are not being used")),
      `the team has to carry it: ${JSON.stringify(team.errors)}`,
    );
    assert.equal(team.rules, "", "and nothing the file held is in force");
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
});

test("the doctor reports an unreadable layer rather than a complete team", async () => {
  const broken = resolveTeam(kit, {}, {}, ["The machine settings are not being used: it is not valid JSON"]);
  const checks = await doctor(kit, broken, probes(["git", "jq"], []));
  const settings = checks.find((check) => check.id === "settings")!;
  assert.equal(settings.ok, false, "a team resolved from a file nobody could read is not a complete team");
  assert.match(settings.detail, /not being used/);
});
