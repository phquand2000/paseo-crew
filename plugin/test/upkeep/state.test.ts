import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readLayer } from "../../server/catalog/team/settings.ts";
import { STATE_VERSION } from "../../server/core/state-version.ts";
import { readJson, writeJson } from "../../server/core/store.ts";
import { loadConfig } from "../../server/desk/project/project.ts";
import { loadIncidents } from "../../server/desk/store/incidents.ts";
import { loadLedger } from "../../server/desk/store/ledger.ts";
import { Outbox } from "../../server/runtime/mail/outbox.ts";
import { STATE_BACKUP, upgradeState } from "../../server/upkeep/state-upgrade.ts";
import { tempDir } from "../tempdir.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "state");
const NOW = Date.parse("2026-09-22T07:12:30Z");

function machineAt(version: string): { root: string; shop: string } {
  const root = tempDir("crew-state-");
  cpSync(join(FIXTURES, version), root, { recursive: true });
  return { root, shop: join(root, "projects", "shop-abc123") };
}

const formatOf = (file: string) => readJson<{ format?: unknown }>(file, {}).format;
const backupsIn = (dir: string) => readdirSync(dir).filter((name) => STATE_BACKUP.test(name));

test("the fixture of the current format exists, so the next change to a kept file has one to be carried from", () => {
  assert.ok(existsSync(join(FIXTURES, `v${STATE_VERSION}`)), `test/fixtures/state/v${STATE_VERSION} is missing`);
});

for (const version of readdirSync(FIXTURES).filter((name) => /^v\d+$/.test(name))) {
  test(`what was kept in state format ${version.slice(1)} is carried to this version and read in full`, () => {
    const { root, shop } = machineAt(version);
    const from = Number(version.slice(1));
    const report = upgradeState(root, undefined, undefined, NOW);
    assert.deepEqual(report.failed, []);
    const moved =
      from === STATE_VERSION ? [] : [`machine: ${from} → ${STATE_VERSION}`, `shop-abc123: ${from} → ${STATE_VERSION}`];
    assert.deepEqual(report.upgraded, moved);
    assert.deepEqual(
      [formatOf(join(root, "state.json")), formatOf(join(shop, "ledger.json"))],
      [STATE_VERSION, STATE_VERSION],
    );
    assert.deepEqual(
      upgradeState(root, undefined, undefined, NOW),
      { upgraded: [], failed: [] },
      "a second start carries nothing",
    );

    const ledger = loadLedger(shop);
    assert.deepEqual([ledger.lanes.L1!.status, ledger.lanes.L1!.landed], ["closed", true]);
    assert.deepEqual(
      [ledger.tasks["L1-T1"]!.status, ledger.tasks["L1-T1"]!.handback?.summary],
      ["merged", "Tax added"],
    );
    assert.deepEqual([ledger.asks.A1!.answer, ledger.asks.A1!.kept], ["Round half up.", false]);
    assert.deepEqual(Object.keys(loadIncidents(shop).items), ["I1"]);
    assert.equal(loadConfig(shop).gate, "true");
    const outbox = new Outbox(join(root, "outbox.json"), () => "", {} as never);
    assert.deepEqual(
      outbox.letters().map((letter) => letter.key),
      ["answer:A1"],
    );
    assert.equal(readLayer(join(root, "settings.json")).status, "ready");
    assert.equal(readLayer(join(shop, "settings.json")).status, "ready");
  });
}

test("files kept before 3.0.0 are state 1, whatever number a build before it left in them: stamped where they are, with nothing set aside", () => {
  const { root, shop } = machineAt("v1");
  const earlier = readJson<Record<string, unknown>>(join(shop, "ledger.json"), {});
  delete earlier.format;
  writeJson(join(shop, "ledger.json"), { ...earlier, version: 5 });
  writeJson(join(root, "state.json"), { version: 5 });
  assert.throws(() => loadLedger(shop), /is at state undefined/, "until the start stamps it, the ledger is refused");
  assert.deepEqual(upgradeState(root, [], 1, NOW), { upgraded: [], failed: [] });
  assert.deepEqual(readJson(join(root, "state.json"), {}), { format: 1 });
  const stamped = readJson<Record<string, unknown>>(join(shop, "ledger.json"), {});
  assert.deepEqual([stamped.format, stamped.version], [1, undefined], "the earlier number goes with the stamp");
  assert.deepEqual([backupsIn(root), backupsIn(shop)], [[], []]);
  assert.equal(loadLedger(shop).tasks["L1-T1"]!.status, "merged");
});

test("a step carries every project and the machine, keeps a copy of the files first, and runs once", () => {
  const { root, shop } = machineAt("v1");
  let runs = 0;
  const steps = [
    {
      to: 2,
      machine: () => runs++,
      project: (state: string) => {
        const ledger = readJson<{ lanes: Record<string, { title: string }> }>(join(state, "ledger.json"), {
          lanes: {},
        });
        for (const lane of Object.values(ledger.lanes)) Object.assign(lane, { name: lane.title });
        writeJson(join(state, "ledger.json"), ledger);
      },
    },
  ];
  assert.deepEqual(upgradeState(root, steps, 2, NOW), {
    upgraded: ["machine: 1 → 2", "shop-abc123: 1 → 2"],
    failed: [],
  });
  const ledger = readJson<{ format: number; lanes: Record<string, { name?: string }> }>(join(shop, "ledger.json"), {
    format: 0,
    lanes: {},
  });
  assert.deepEqual(
    [ledger.format, ledger.lanes.L1?.name, formatOf(join(root, "state.json"))],
    [2, "Checkout totals", 2],
  );
  const [backup] = backupsIn(shop);
  assert.equal(backup, "backup-state-1-20260922-071230");
  assert.equal(formatOf(join(shop, backup, "ledger.json")), 1, "the copy is the ledger as it was");
  assert.deepEqual(backupsIn(root), ["backup-state-1-20260922-071230"]);
  assert.deepEqual(upgradeState(root, steps, 2, NOW), { upgraded: [], failed: [] });
  assert.equal(runs, 1);
});

test("a step that fails puts the project's files back as they were, and says why", () => {
  const { root, shop } = machineAt("v1");
  const before = readFileSync(join(shop, "ledger.json"), "utf-8");
  const steps = [
    {
      to: 2,
      project: (state: string) => {
        writeJson(join(state, "ledger.json"), { half: "written" });
        throw new Error("lane L1 has no title");
      },
    },
  ];
  const report = upgradeState(root, steps, 2, NOW);
  assert.deepEqual(report.upgraded, ["machine: 1 → 2"]);
  assert.match(report.failed[0]!.error, /could not go from state 1 to 2: lane L1 has no title/);
  assert.equal(readFileSync(join(shop, "ledger.json"), "utf-8"), before);
});

test("state a newer version made is refused, not read", () => {
  const { root, shop } = machineAt("v1");
  writeJson(join(shop, "ledger.json"), {
    ...readJson<object>(join(shop, "ledger.json"), {}),
    format: STATE_VERSION + 1,
  });
  assert.match(upgradeState(root, undefined, undefined, NOW).failed[0]!.error, /made by a newer Paseo Crew/);
  assert.throws(() => loadLedger(shop), /made by a newer Paseo Crew/);
});
