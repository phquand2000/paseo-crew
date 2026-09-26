import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readLayer, writeLayer } from "../../server/catalog/team/settings.ts";
import type { Layer } from "../../shared/settings.ts";
import { seatProblems } from "../../server/catalog/seat/seats.ts";
import { resolveTeam } from "../../server/catalog/team/team.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const ok = () => [];

test("the settings store saves only over what it read, and never over a file it could not read", () => {
  const file = join(tempDir("sw2-settings-"), "nested", "settings.json");
  const fresh = readLayer(file);
  assert.deepEqual(
    [fresh.status, fresh.status === "ready" && fresh.values],
    ["ready", {}],
    "missing settings read as empty",
  );
  const held = { rules: "keep me", roles: { lead: { thinking: "high" } }, attention: { tickSeconds: 10 } };
  const saved = writeLayer(file, fresh.revision, held, ok);
  assert.equal(saved.status, "saved", "a write with the revision read saves, making the file's folder");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf-8")), held);
  assert.deepEqual(readLayer(file), {
    status: "ready",
    revision: saved.status === "saved" && saved.revision,
    values: held,
  });

  const stored = readFileSync(file, "utf-8");
  assert.equal(
    writeLayer(file, fresh.revision, { rules: "two" }, ok).status,
    "conflict",
    "a write based on a stale revision",
  );
  const { revision } = readLayer(file);
  assert.equal(writeLayer(file, revision, { color: "red" }, ok).status, "invalid", "a value the schema does not know");
  assert.deepEqual(
    writeLayer(file, revision, { roles: { lead: { harness: "x" } } }, () => ["The Lead runs on x"]),
    {
      status: "invalid",
      error: "The Lead runs on x",
    },
  );
  assert.equal(readFileSync(file, "utf-8"), stored, "and nothing refused is written");

  const onDisk = { ...held, somethingNewer: true };
  writeFileSync(file, JSON.stringify(onDisk));
  const unknown = readLayer(file);
  assert.equal(unknown.status, "invalid", "a key a newer plugin or a hand edit added makes the whole file unreadable");
  const refused = writeLayer(file, unknown.revision, { flow: { live: false } }, ok);
  assert.match(
    refused.status === "invalid" ? refused.error : "",
    /could not be read/,
    "the client renders unreadable settings as empty, so this is the save that used to erase rules, roles and attention",
  );
  assert.deepEqual(JSON.parse(readFileSync(file, "utf-8")), onDisk);

  writeFileSync(file, `${JSON.stringify(onDisk).slice(0, -1)},}`);
  const broken = readLayer(file);
  assert.match(
    broken.status === "invalid" ? broken.error : "",
    /is not JSON/,
    "a trailing comma is not a project with no settings yet",
  );
  assert.equal(writeLayer(file, broken.revision, { flow: { live: false } }, ok).status, "invalid");
  assert.match(
    readFileSync(file, "utf-8"),
    /keep me/,
    "the rules, the role choices and any pasted server's token are still there",
  );
});

test("a rule that would leave a seat unbuildable is refused where it is written, not where it lands", () => {
  const kit = makeKit();
  const machine = join(tempDir("sw2-settings-"), "settings.json");
  const paths = { guides: "/guides", state: "$SEATWORKS_STATE" };
  const unbuildable = (layer: Layer) => {
    const team = resolveTeam(kit, layer);
    return team.errors.length > 0
      ? team.errors
      : Object.keys(team.roles).flatMap((role) => seatProblems(kit, team, role, paths));
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
