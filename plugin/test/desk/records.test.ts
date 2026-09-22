import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { tempDir } from "../tempdir.ts";
import { appendRolling } from "../../server/core/rolling.ts";
import { type Lane, emptyLedger } from "../../server/desk/ledger.ts";
import { GATE_DAYS, GATE_LOGS_PER_OWNER, HANDBACK_DAYS, tidyRecords } from "../../server/desk/records.ts";

const DAY = 86_400_000;

test("a record log rolls over, keeps its newest roll as text for a grep, and packs and drops the older ones", async () => {
  const dir = tempDir("sw2-roll-");
  const line = `${"x".repeat(20)}\n`;
  const roll = { dir, current: "events.log", prefix: "events.", ext: ".log", rotateAt: 2 * line.length, keep: 3, plain: 1 };
  for (let index = 0; index < 12; index++) await appendRolling(roll, line);
  const names = readdirSync(dir).sort();
  assert.deepEqual(names.filter((name) => !name.endsWith(".gz")), ["events.00000005.log", "events.log"], names.join(", "));
  assert.deepEqual(names.filter((name) => name.endsWith(".gz")), ["events.00000003.log.gz", "events.00000004.log.gz"]);
  assert.equal(gunzipSync(readFileSync(join(dir, "events.00000003.log.gz"))).toString("utf-8"), line.repeat(2));
  assert.equal(readFileSync(join(dir, "events.log"), "utf-8"), line.repeat(2), "the name agents read stays the live file");
});

const lane = (id: string, status: Lane["status"], outcome = ""): Lane =>
  ({ id, title: id, outcome, acceptance: [], outOfScope: [], base: "main", branch: `lane/${id}`, writeSet: [], contracts: [], opener: "s", status, openedAt: 0, tasks: 0 }) as Lane;

test("records no agent can still be reading go, and what an open lane may read stays", () => {
  const state = tempDir("sw2-tidy-");
  const now = 100 * DAY;
  const gates = join(state, "gates");
  const handbacks = join(state, "handbacks");
  mkdirSync(gates);
  mkdirSync(handbacks);
  const touch = (dir: string, name: string) => writeFileSync(join(dir, name), "x");
  for (let run = 0; run < GATE_LOGS_PER_OWNER + 2; run++) touch(gates, `L1-T1-${now - run * 1000}.log`);
  touch(gates, `L1-${now - 50 * DAY}.log`);
  touch(gates, `L2-T3-${now - (GATE_DAYS + 1) * DAY}.log`);
  touch(gates, `L2-T3-${now - DAY}.log`);
  touch(gates, `L9-${now - (GATE_DAYS + 1) * DAY}.log`);
  touch(gates, "notes.txt");
  const old = now - (HANDBACK_DAYS + 1) * DAY;
  touch(handbacks, `L1-T1-${old}.md`);
  touch(handbacks, `L2-T3-${old}.md`);
  touch(handbacks, `L2-T4-${old}.md`);
  touch(handbacks, `L2-T5-${now - DAY}.md`);
  const ledger = emptyLedger();
  ledger.lanes = { L1: lane("L1", "open"), L2: lane("L2", "closed"), L3: lane("L3", "open", `Carry on from handbacks/L2-T4-${old}.md`) };

  tidyRecords(state, ledger, now);

  const keptLogs = readdirSync(gates).sort();
  assert.equal(keptLogs.filter((name) => name.startsWith("L1-T1-")).length, GATE_LOGS_PER_OWNER, "an open lane keeps the newest runs per task");
  assert.ok(keptLogs.includes(`L1-T1-${now}.log`));
  assert.ok(keptLogs.includes(`L1-${now - 50 * DAY}.log`), "the only run of its owner, however old, while the lane is open");
  assert.ok(!keptLogs.includes(`L2-T3-${now - (GATE_DAYS + 1) * DAY}.log`), "an old run of a closed lane");
  assert.ok(keptLogs.includes(`L2-T3-${now - DAY}.log`), "a recent run of a closed lane");
  assert.ok(!keptLogs.includes(`L9-${now - (GATE_DAYS + 1) * DAY}.log`), "an old run of a lane the ledger no longer has");
  assert.ok(keptLogs.includes("notes.txt"), "a file the desk did not name is not its to drop");
  assert.deepEqual(readdirSync(handbacks).sort(), [`L1-T1-${old}.md`, `L2-T4-${old}.md`, `L2-T5-${now - DAY}.md`]);
});
