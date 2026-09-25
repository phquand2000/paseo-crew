import assert from "node:assert/strict";
import { test } from "node:test";
import { type Probes, doctor } from "../../server/runtime/doctor.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TeamSource } from "../../server/runtime/team-source.ts";
import { home, stateRoot } from "../../server/core/paths.ts";
import { makeKit } from "../kit.ts";

const kit = makeKit();

function probes(bins: string[], tools: string[] | null, docsUp = true, paths: string[] = [join(home(), ".omp", "agent", "agent.db")]): Probes {
  return {
    has: (bin) => bins.includes(bin),
    exists: (path) => paths.includes(path),
    tools: async () => (tools ? { names: tools } : { error: "refused" }),
    reaches: async () => (docsUp ? { ok: true } : { ok: false, error: "timeout" }),
  };
}

test("doctor names what a machine is missing for the chosen team", async () => {
  const team = resolveTeam(kit, { mcp: { docs: { enabled: true } } });
  const checks = await doctor(kit, team, probes(["git", "claude"], ["ide_find_references", "ide_open_project"], false));
  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  assert.equal(byId.settings!.ok, true);
  assert.equal(byId["bin:jq"]!.ok, false);
  assert.equal(byId["harness:claude"]!.ok, true);
  assert.equal(byId["harness:omp"]!.ok, false);
  assert.equal(byId["mcp:ide"]!.ok, false);
  assert.match(byId["mcp:ide"]!.detail, /ide_refactor_rename/);
  assert.equal(byId["mcp:docs"]!.ok, false);
});

test("doctor passes a machine that has everything, and skips servers nobody uses", async () => {
  const team = resolveTeam(kit);
  const checks = await doctor(kit, team, probes(["git", "jq", "claude", "omp"], ["ide_find_references", "ide_refactor_rename", "ide_open_project"]));
  assert.ok(checks.every((check) => check.ok), JSON.stringify(checks));
  assert.equal(checks.some((check) => check.id === "mcp:docs"), false);
  const down = await doctor(kit, team, probes(["git", "jq", "claude", "omp"], null));
  assert.match(down.find((check) => check.id === "mcp:ide")!.detail, /No IDE server answered/);
});

test("what a harness says its seats need on this machine is checked, and how to get it is said", async () => {
  const team = resolveTeam(kit);
  const missing = await doctor(kit, team, probes(["git", "jq", "claude", "omp"], ["ide_find_references", "ide_refactor_rename", "ide_open_project"], true, []));
  const check = missing.find((entry) => entry.id === "harness:omp:HOME/.omp/agent/agent.db")!;
  assert.equal(check.ok, false);
  assert.match(check.detail, /agent\.db for Peer, Scribe\. Log in with omp once/);
  const present = await doctor(kit, team, probes(["git", "jq", "claude", "omp"], ["ide_find_references", "ide_refactor_rename", "ide_open_project"]));
  assert.equal(present.find((entry) => entry.id === "harness:omp:HOME/.omp/agent/agent.db")!.ok, true);
});

test("a server that cannot be read costs its own check, not the whole report", async () => {
  const team = resolveTeam(kit, { mcp: { docs: { enabled: true } } });
  // A null in an outside server's tools list once threw out of the report, taking every check with it.
  const hostile: Probes = {
    has: (bin) => ["git", "jq", "claude"].includes(bin),
    exists: () => true,
    tools: async () => {
      throw new Error("the list it gave is not a list of tools");
    },
    reaches: async () => ({ ok: true }),
  };
  const checks = await doctor(kit, team, hostile);
  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  assert.equal(byId.settings!.ok, true, "the checks that have nothing to do with that server still arrive");
  assert.equal(byId["mcp:ide"]!.ok, false);
  assert.match(byId["mcp:ide"]!.detail, /could not be checked: the list it gave is not a list of tools/);
  assert.equal(byId["mcp:docs"]!.ok, true);
});

test("settings that could not be read are not a team the owner wrote, and the doctor says so", () => {
  const state = stateRoot();
  mkdirSync(state, { recursive: true });
  // The commonest hand edit; read as {}, the doctor reported the kit's defaults as the owner's team.
  writeFileSync(join(state, "settings.json"), '{ "rules": "Keep diffs small.", }');
  const team = new TeamSource(kit).teamFor();
  assert.ok(
    team.errors.some((line) => line.includes("machine settings are not being used")),
    `the team has to carry it: ${JSON.stringify(team.errors)}`,
  );
  assert.equal(team.rules, "", "and nothing the file held is in force");
});

test("the doctor reports an unreadable layer rather than a complete team", async () => {
  const broken = resolveTeam(kit, {}, {}, ["The machine settings are not being used: it is not valid JSON"]);
  const checks = await doctor(kit, broken, probes(["git", "jq"], []));
  const settings = checks.find((check) => check.id === "settings")!;
  assert.equal(settings.ok, false, "a team resolved from a file nobody could read is not a complete team");
  assert.match(settings.detail, /not being used/);
});
