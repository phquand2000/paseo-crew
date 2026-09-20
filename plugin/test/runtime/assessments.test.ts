import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { tempDir } from "../tempdir.ts";
import { type Kept, assessmentsDir, keepAssessment, readAssessments } from "../../server/runtime/watch/assessments.ts";

const record = (at: number): Kept => ({
  at,
  askedAt: at,
  seat: "peer-1",
  provider: "sw2-peer-claude",
  turnId: "t1",
  running: true,
  sensor: "jev",
  model: "typesafe/jev-1.13-20260917",
  id: `gen-${at}`,
  cost: 0.00002,
  questions: { needs_human: { instructions: "Does it?" } },
  answers: { needs_human: 0.1 },
  facts: [],
  found: [],
  verdicts: [],
  state: { recent: ["x".repeat(400)] },
});

test("kept assessments roll over into packed files, the oldest go first, and every one left reads back once and in order", async () => {
  const state = tempDir("sw2-kept-");
  const two = 2 * Buffer.byteLength(`${JSON.stringify(record(1000))}\n`);
  for (let index = 0; index < 12; index++) await keepAssessment(state, record(1000 + index), two, 3);
  const dir = assessmentsDir(state);
  const files = readdirSync(dir).sort();
  assert.equal(files.filter((name) => name.endsWith(".jsonl.gz")).length, 3, files.join(", "));
  assert.deepEqual(files.filter((name) => !name.endsWith(".jsonl.gz")), ["current.jsonl"]);
  assert.equal(gunzipSync(readFileSync(join(dir, files[0]!))).toString("utf-8").split("\n").filter(Boolean).length, 2);
  const read = readAssessments(state);
  assert.deepEqual(read.kept.map((kept) => kept.at), [1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011]);
  assert.equal(read.broken, 0);

  const packed = files.find((name) => name.endsWith(".gz"))!;
  writeFileSync(join(dir, packed.replace(/\.gz$/, "")), gunzipSync(readFileSync(join(dir, packed))));
  copyFileSync(join(dir, packed), join(dir, `${packed}.part`));
  appendFileSync(join(dir, "current.jsonl"), '{"at": 2000, "seat"');
  const again = readAssessments(state);
  assert.deepEqual(again.kept.map((kept) => kept.at), [1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011], "a file packed but not yet removed, or half packed, is read once");
  assert.equal(again.broken, 1, "a line cut short by a crash is counted, not read");
});

test("what was written last is kept even when the clock steps back, and a pack left half done goes with its file", async () => {
  const state = tempDir("sw2-kept-back-");
  const two = 2 * Buffer.byteLength(`${JSON.stringify(record(1000))}\n`);
  for (let index = 0; index < 6; index++) await keepAssessment(state, record(5000 - index * 100), two, 2);
  const dir = assessmentsDir(state);
  const oldest = readdirSync(dir).filter((name) => name.endsWith(".jsonl.gz")).sort()[0]!;
  writeFileSync(join(dir, `${oldest.replace(/\.gz$/, "")}.gz.part`), "half");
  for (let index = 6; index < 10; index++) await keepAssessment(state, record(5000 - index * 100), two, 2);
  assert.deepEqual(readAssessments(state).kept.map((kept) => kept.at), [4100, 4200, 4300, 4400, 4500, 4600], "the six written last, though each carries an earlier time than the one before")
  assert.ok(!readdirSync(dir).some((name) => name.endsWith(".part")), "the half-packed file went when its file did");
});
