import assert from "node:assert/strict";
import { test } from "node:test";
import { type Lane, type Ledger, type Task, emptyLedger } from "../../server/desk/ledger.ts";
import { deskFacts, prewritten } from "../../server/runtime/watch/history.ts";

const READING = { reworksAt: 3, reviewsAt: 3 };

const lane = (over: Partial<Lane> = {}): Lane => ({
  id: "L1",
  title: "Discounts",
  outcome: "Orders apply a percentage discount",
  acceptance: ["a 10% code lowers the total"],
  outOfScope: [],
  base: "main",
  branch: "lane/l1",
  writeSet: [],
  contracts: [],
  opener: "sup",
  lead: "lead-1",
  status: "open",
  openedAt: 0,
  tasks: 0,
  ...over,
});

const task = (over: Partial<Task> & { id: string }): Task => ({
  lane: "L1",
  kind: "code",
  mode: "lane",
  title: "Apply discount",
  goal: "Totals reflect the code",
  acceptance: ["10% off"],
  owned: ["src/pricing.js"],
  outOfScope: [],
  status: "running",
  openedAt: 0,
  updatedAt: 0,
  silent: 0,
  ...over,
});

function ledgerOf(tasks: Task[], over: Partial<Lane> = {}): Ledger {
  const held = emptyLedger();
  held.lanes.L1 = lane(over);
  for (const entry of tasks) held.tasks[entry.id] = entry;
  return held;
}

const kinds = (ledger: Ledger) => deskFacts(ledger, READING).map((seen) => seen.fact.kind).sort();

test("a task sent back again and again is a loop, and the lane patching several at once is a missing foundation", () => {
  const settling = ledgerOf([task({ id: "L1-T1", reworks: 2 })]);
  assert.deepEqual(kinds(settling), [], "two sendings-back is a correction, not yet a loop");

  const looping = ledgerOf([task({ id: "L1-T1", reworks: 3, handback: { file: "f", outcome: "partial", summary: "s", at: 0 } })]);
  const [seen] = deskFacts(looping, READING);
  assert.equal(seen!.fact.kind, "rework-loop");
  assert.equal(seen!.seat, "lead-1", "the Lead decides to send it back, so the Lead is who this is about");
  assert.match(seen!.fact.quote, /L1-T1 \(Apply discount\) has been sent back 3 times; the last outcome was partial/);

  // The same three sendings spread over different tasks is the other shape: one hole, patched a task
  // at a time. It is not the same finding and must not be reported as one.
  const spread = ledgerOf([task({ id: "L1-T1", reworks: 1 }), task({ id: "L1-T2", reworks: 1 }), task({ id: "L1-T3", reworks: 1 })]);
  assert.deepEqual(kinds(spread), ["patched-not-fixed"]);
  assert.match(deskFacts(spread, READING)[0]!.fact.quote, /3 sendings-back across 3 tasks .*L1-T1 ×1, L1-T2 ×1, L1-T3 ×1/);
});

test("reviews piling up on one task are only a finding while that task is unsettled", () => {
  const rounds = [1, 2, 3].map((n) => task({ id: `L1-R${n}`, kind: "review", of: "L1-T1", title: `review ${n}`, handback: { file: "f", outcome: "changes", summary: "s", at: 0 } }));
  const open = ledgerOf([task({ id: "L1-T1" }), ...rounds]);
  assert.deepEqual(kinds(open), ["reviews-unconverged"]);
  assert.match(deskFacts(open, READING)[0]!.fact.quote, /3 reviews of L1-T1 .*which is running: changes, changes, changes/);

  const accepted = ledgerOf([task({ id: "L1-T1", status: "merged" }), ...rounds]);
  assert.deepEqual(kinds(accepted), [], "three rounds that ended in acceptance converged");

  const fewer = ledgerOf([task({ id: "L1-T1" }), ...rounds.slice(0, 2)]);
  assert.deepEqual(kinds(fewer), [], "two reviews is a second opinion");
});

test("a review asked for certainty, and a brief that writes the work out, are both on the record", () => {
  const timid = ledgerOf([task({ id: "L1-R1", kind: "review", of: "L1-T1", goal: "Check the pricing change. Report only issues you are certain of." })]);
  assert.deepEqual(kinds(timid), ["certainty-only"]);
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-R1", kind: "review", of: "L1-T1", goal: "Check the pricing change for correctness and rounding." })])), []);

  const typed = ledgerOf([task({ id: "L1-T1", context: "1. Create src/pricing.ts with a function applyCode\n2. Then add a test\n3. Then wire it in app.ts" })]);
  assert.deepEqual(kinds(typed), ["brief-prewritten"]);
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", context: "The discount table lives in the pricing service; the Human wants stacking to stop." })])), []);
});

test("a brief is judged by whether it hands over the answer, not by how long it is", () => {
  assert.equal(prewritten(""), false);
  assert.equal(prewritten("Totals must reflect the code. Acceptance: a 10% code lowers the total. You decide where it goes."), false);
  assert.equal(prewritten("Here is the shape:\n```ts\nexport function applyCode() {}\n```\nand 1. do this first"), true, "a code fence plus a step list is the answer, typed out");
  assert.equal(prewritten("1. edit src/pricing.ts, exporting a const RATES"), true, "one step naming a file and a member is enough");
  assert.equal(prewritten("The rounding rule is in RFC 1. Read it before you start."), false, "a reference is not a step");
});

test("nothing is read from a lane with no Lead to be about, or from a lane that is closed", () => {
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", reworks: 5 })], { lead: undefined })), []);
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", reworks: 5 })], { status: "closed" })), []);
});

test("what changes is the sign, so a condition that only holds is reported once", () => {
  const held = ledgerOf([task({ id: "L1-T1", reworks: 3 })]);
  assert.equal(deskFacts(held, READING)[0]!.sign, deskFacts(held, READING)[0]!.sign, "reading the same ledger twice says the same thing");
  held.tasks["L1-T1"]!.reworks = 4;
  assert.notEqual(deskFacts(held, READING)[0]!.sign, "L1-T1:3", "and a fourth sending-back is new evidence");
});
