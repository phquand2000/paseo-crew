import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readLayer, revisionOf, writeLayer } from "../../server/catalog/settings.ts";
import type { Layer } from "../../shared/settings.ts";
import { seatProblems } from "../../server/catalog/seats.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const ok = () => [];

test("missing settings read as empty, and a write with the read revision saves", () => {
  const file = join(tempDir("sw2-settings-"), "nested", "settings.json");
  const first = readLayer(file);
  assert.deepEqual(first, { status: "ready", revision: revisionOf({}), values: {} });
  const values = { mcp: { docs: { enabled: true } }, roles: { lead: { thinking: "high" } } };
  const saved = writeLayer(file, first.revision, values, ok);
  assert.equal(saved.status, "saved");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf-8")), values);
  assert.deepEqual(readLayer(file), { status: "ready", revision: revisionOf(values), values });
});

test("a write based on a stale revision is refused as a conflict", () => {
  const file = join(tempDir("sw2-settings-"), "settings.json");
  const { revision } = readLayer(file);
  assert.equal(writeLayer(file, revision, { rules: "one" }, ok).status, "saved");
  const late = writeLayer(file, revision, { rules: "two" }, ok);
  assert.equal(late.status, "conflict");
});

test("values outside the schema or that fail the team check are refused and not written", () => {
  const file = join(tempDir("sw2-settings-"), "settings.json");
  const { revision } = readLayer(file);
  const unknown = writeLayer(file, revision, { color: "red" }, ok);
  assert.equal(unknown.status, "invalid");
  const refused = writeLayer(file, revision, { roles: { lead: { harness: "x" } } }, () => ["The Lead runs on x"]);
  assert.deepEqual(refused, { status: "invalid", error: "The Lead runs on x" });
  assert.equal(readLayer(file).revision, revision);
});

test("a settings file that cannot be read is never saved over, because saving would throw away what it holds", () => {
  const file = join(tempDir("sw2-settings-"), "settings.json");
  const { revision } = readLayer(file);
  const held = { rules: "keep me", roles: { lead: { thinking: "high" } }, attention: { tickSeconds: 10 } };
  assert.equal(writeLayer(file, revision, held, ok).status, "saved");

  // A key the schema does not know — a newer plugin's, or a hand edit — makes the whole file unreadable.
  const onDisk = { ...held, somethingNewer: true };
  writeFileSync(file, JSON.stringify(onDisk));
  const read = readLayer(file);
  assert.equal(read.status, "invalid");

  // The client renders unreadable settings as empty, so this is the write that used to erase rules, roles and attention.
  const refused = writeLayer(file, read.revision, { flow: { live: false } }, ok);
  assert.equal(refused.status, "invalid");
  assert.match(refused.status === "invalid" ? refused.error : "", /could not be read/);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf-8")), onDisk);

  // A file that does not parse at all: every layer key is optional, so reading it as {} allowed the next save.
  writeFileSync(file, `${JSON.stringify(onDisk).slice(0, -1)},}`);
  const broken = readLayer(file);
  assert.equal(broken.status, "invalid", "a trailing comma is not a project with no settings yet");
  assert.match(broken.status === "invalid" ? broken.error : "", /is not JSON/);
  const alsoRefused = writeLayer(file, broken.revision, { flow: { live: false } }, ok);
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

  // Nothing in the schema or team resolution objects to this line, yet every Peer and Reviewer seat fails to build.
  const rule = { rules: "Leave the Paseo config alone; ask before touching migrations." };
  assert.deepEqual(resolveTeam(kit, rule).errors, []);
  const refused = writeLayer(machine, readLayer(machine).revision, rule, unbuildable);
  assert.equal(refused.status, "invalid");
  assert.match(refused.status === "invalid" ? refused.error : "", /must not see: paseo/);
  assert.equal(existsSync(machine), false, "and nothing was written, so there is nothing to undo");

  const rephrased = { rules: "Leave the daemon config alone; ask before touching migrations." };
  assert.equal(writeLayer(machine, readLayer(machine).revision, rephrased, unbuildable).status, "saved");
});
