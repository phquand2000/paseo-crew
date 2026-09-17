import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type Layer, MachineLayerSchema, ProjectLayerSchema, readLayer, revisionOf, writeLayer } from "../../server/catalog/settings.ts";
import { seatProblems } from "../../server/catalog/seats.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { makeKit } from "../../server/catalog/testkit.ts";
import { tempDir } from "../../server/core/testing.ts";

const ok = () => [];

test("missing settings read as empty, and a write with the read revision saves", () => {
  const file = join(tempDir("sw2-settings-"), "nested", "settings.json");
  const first = readLayer(file, MachineLayerSchema);
  assert.deepEqual(first, { status: "ready", revision: revisionOf({}), values: {} });
  const values = { mcp: { docs: { enabled: true } }, roles: { lead: { thinking: "high" } } };
  const saved = writeLayer(file, MachineLayerSchema, first.revision, values, ok);
  assert.equal(saved.status, "saved");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf-8")), values);
  assert.deepEqual(readLayer(file, MachineLayerSchema), { status: "ready", revision: revisionOf(values), values });
});

test("a write based on a stale revision is refused as a conflict", () => {
  const file = join(tempDir("sw2-settings-"), "settings.json");
  const { revision } = readLayer(file, MachineLayerSchema);
  assert.equal(writeLayer(file, MachineLayerSchema, revision, { rules: "one" }, ok).status, "saved");
  const late = writeLayer(file, MachineLayerSchema, revision, { rules: "two" }, ok);
  assert.equal(late.status, "conflict");
});

test("values outside the schema or that fail the team check are refused and not written", () => {
  const file = join(tempDir("sw2-settings-"), "settings.json");
  const { revision } = readLayer(file, MachineLayerSchema);
  const unknown = writeLayer(file, MachineLayerSchema, revision, { color: "red" }, ok);
  assert.equal(unknown.status, "invalid");
  const project = writeLayer(file, ProjectLayerSchema, revision, { watching: true }, ok);
  assert.equal(project.status, "invalid");
  const refused = writeLayer(file, MachineLayerSchema, revision, { roles: { lead: { harness: "x" } } }, () => ["The Lead runs on x"]);
  assert.deepEqual(refused, { status: "invalid", error: "The Lead runs on x" });
  assert.equal(readLayer(file, MachineLayerSchema).revision, revision);
});

test("a settings file that cannot be read is never saved over, because saving would throw away what it holds", () => {
  const file = join(tempDir("sw2-settings-"), "settings.json");
  const { revision } = readLayer(file, MachineLayerSchema);
  const held = { rules: "keep me", roles: { lead: { thinking: "high" } }, attention: { tickSeconds: 10 } };
  assert.equal(writeLayer(file, MachineLayerSchema, revision, held, ok).status, "saved");

  // A key the schema does not know — a newer plugin's, or a hand edit — makes the whole file unreadable.
  const onDisk = { ...held, somethingNewer: true };
  writeFileSync(file, JSON.stringify(onDisk));
  const read = readLayer(file, MachineLayerSchema);
  assert.equal(read.status, "invalid");

  // The client renders unreadable settings as empty, so this is the write that used to erase rules, roles and attention.
  const refused = writeLayer(file, MachineLayerSchema, read.revision, { flow: { live: false } }, ok);
  assert.equal(refused.status, "invalid");
  assert.match(refused.status === "invalid" ? refused.error : "", /could not be read/);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf-8")), onDisk);

  // And a file that does not parse at all, which is the likelier hand edit: every key in a layer is
  // optional, so the empty object it used to read as was a valid layer and the next save was allowed.
  writeFileSync(file, `${JSON.stringify(onDisk).slice(0, -1)},}`);
  const broken = readLayer(file, MachineLayerSchema);
  assert.equal(broken.status, "invalid", "a trailing comma is not a project with no settings yet");
  assert.match(broken.status === "invalid" ? broken.error : "", /is not JSON/);
  const alsoRefused = writeLayer(file, MachineLayerSchema, broken.revision, { flow: { live: false } }, ok);
  assert.equal(alsoRefused.status, "invalid");
  assert.match(readFileSync(file, "utf-8"), /keep me/, "the rules, the role choices and any pasted server's token are still there");
});

test("a rule that would leave a seat unbuildable is refused where it is written, not where it lands", () => {
  const kit = makeKit();
  const machine = join(tempDir("sw2-settings-"), "settings.json");
  const paths = { guides: "/guides", state: "$SEATWORKS_STATE" };
  const unbuildable = (layer: Layer) => {
    const team = resolveTeam(kit, layer);
    return team.errors.length > 0 ? team.errors : Object.keys(team.roles).flatMap((role) => seatProblems(kit, team, role, paths));
  };

  // The line a real owner writes about the tool they are configuring. Nothing in the schema or the
  // team resolution objects to it, and every Peer and Reviewer seat then fails to build.
  const rule = { rules: "Leave the Paseo config alone; ask before touching migrations." };
  assert.deepEqual(resolveTeam(kit, rule).errors, []);
  const refused = writeLayer(machine, MachineLayerSchema, readLayer(machine, MachineLayerSchema).revision, rule, unbuildable);
  assert.equal(refused.status, "invalid");
  assert.match(refused.status === "invalid" ? refused.error : "", /must not see: paseo/);
  assert.equal(existsSync(machine), false, "and nothing was written, so there is nothing to undo");

  const rephrased = { rules: "Leave the daemon config alone; ask before touching migrations." };
  assert.equal(writeLayer(machine, MachineLayerSchema, readLayer(machine, MachineLayerSchema).revision, rephrased, unbuildable).status, "saved");
});
