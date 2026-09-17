import assert from "node:assert/strict";
import { test } from "node:test";
import { type Probes, doctor } from "../../server/runtime/doctor.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { makeKit } from "../../server/catalog/testkit.ts";

const kit = makeKit();

function probes(bins: string[], tools: string[] | null, docsUp = true): Probes {
  return {
    has: (bin) => bins.includes(bin),
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

test("a malformed answer from one server costs that server's check, not the whole report", async () => {
  const team = resolveTeam(kit, { mcp: { docs: { enabled: true } } });
  // What an outside server answers is data. A null in its tools list used to throw out of the report
  // and take the settings, git and harness checks — computed before it — with the exception.
  const hostile: Probes = {
    has: (bin) => ["git", "jq", "claude"].includes(bin),
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
