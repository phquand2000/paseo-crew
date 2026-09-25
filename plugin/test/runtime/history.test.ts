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
  hints: ["src/pricing.js"],
  holds: [],
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

const finished = { file: "f", outcome: "complete", summary: "s", at: 0 };

test("a task sent back again and again is a loop, and the lane patching several at once is a missing foundation", () => {
  const settling = ledgerOf([task({ id: "L1-T1", reworks: 2 })]);
  assert.deepEqual(kinds(settling), [], "two sendings-back is a correction, not yet a loop");

  const looping = ledgerOf([task({ id: "L1-T1", reworks: 3, handback: { file: "f", outcome: "partial", summary: "s", at: 0 } })]);
  const [seen] = deskFacts(looping, READING);
  assert.equal(seen!.fact.kind, "rework-loop");
  assert.equal(seen!.seat, "lead-1", "the Lead decides to send it back, so the Lead is who this is about");
  assert.match(seen!.fact.quote, /L1-T1 \(Apply discount\) has been sent back 3 times, last outcome partial/);

  // The same three sendings spread over tasks is one hole patched a task at a time, a different finding.
  const spread = ledgerOf([task({ id: "L1-T1", reworks: 1 }), task({ id: "L1-T2", reworks: 1 }), task({ id: "L1-T3", reworks: 1 })]);
  assert.deepEqual(kinds(spread), ["patched-not-fixed"]);
  assert.match(deskFacts(spread, READING)[0]!.fact.quote, /3 sendings-back across 3 tasks .*L1-T1 ×1, L1-T2 ×1, L1-T3 ×1/);
});

test("reviews piling up on one task are only a finding while that task is unsettled", () => {
  const rounds = [1, 2, 3].map((n) => task({ id: `L1-R${n}`, kind: "review", of: "L1-T1", title: `review ${n}`, handback: { file: "f", outcome: "changes", summary: "s", at: 0 } }));
  const open = ledgerOf([task({ id: "L1-T1" }), ...rounds]);
  assert.deepEqual(kinds(open), ["reviews-unconverged"]);
  assert.match(deskFacts(open, READING)[0]!.fact.quote, /3 reviews of L1-T1 .*which is running: changes, changes, changes/);

  const accepted = ledgerOf([task({ id: "L1-T1", status: "merged", handback: finished }), ...rounds]);
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

test("the quote is the whole of what was counted, so the book can tell new evidence from the same evidence", () => {
  const held = ledgerOf([task({ id: "L1-T1", reworks: 3 })]);
  const first = deskFacts(held, READING)[0]!.fact.quote;
  assert.equal(deskFacts(held, READING)[0]!.fact.quote, first, "reading the same ledger twice says the same words");
  held.tasks["L1-T1"]!.reworks = 4;
  assert.notEqual(deskFacts(held, READING)[0]!.fact.quote, first, "a fourth sending-back is new evidence");

  // The book keys an incident by seat and kind, and the seat is the Lead, so one fact of a kind per lane.
  const two = ledgerOf([task({ id: "L1-T1", reworks: 3 }), task({ id: "L1-T2", reworks: 3 })]);
  const loops = deskFacts(two, READING).filter((seen) => seen.fact.kind === "rework-loop");
  assert.equal(loops.length, 1);
  assert.match(loops[0]!.fact.quote, /L1-T1 .*sent back 3 times.*; L1-T2 .*sent back 3 times/);
});

test("a task that was accepted or cut has stopped going round, whatever it took to get there", () => {
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", reworks: 4, status: "merged", handback: finished })])), []);
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", reworks: 4, status: "cut" })])), []);
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", reworks: 2, status: "merged", handback: finished }), task({ id: "L1-T2", reworks: 2 })])), [], "and does not count toward the lane's total");
});

test("a task taken in although its Peer never said it was finished is on the record, and a finished one is not", () => {
  const partial = ledgerOf([task({ id: "L1-T1", status: "merged", handback: { file: "f", outcome: "partial", summary: "s", at: 0 } })]);
  assert.deepEqual(kinds(partial), ["accepted-unfinished"]);
  assert.match(deskFacts(partial, READING)[0]!.fact.quote, /L1-T1 \(Apply discount\) was accepted after its Peer handed it back partial/);
  assert.equal(deskFacts(partial, READING)[0]!.seat, "lead-1", "accepting is the Lead's act, so the Lead is who this is about");

  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", status: "merged", handback: { file: "f", outcome: "blocked", summary: "s", at: 0 } })])), ["accepted-unfinished"]);
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", status: "merged", handback: { file: "f", outcome: "complete", summary: "s", at: 0 } })])), [], "a Peer that said it finished raises nothing");

  // `accept` refuses only merged, queued, merging or cut tasks, so a task can be taken in never handed back.
  const never = ledgerOf([task({ id: "L1-T1", status: "merged" })]);
  assert.deepEqual(kinds(never), ["accepted-unfinished"]);
  assert.match(deskFacts(never, READING)[0]!.fact.quote, /though it was never handed back/);

  // The desk counted the quiet turns itself, so saying so spares the Supervisor reconstructing it.
  const quiet = ledgerOf([task({ id: "L1-T1", status: "merged", silent: 3 })]);
  assert.match(deskFacts(quiet, READING)[0]!.fact.quote, /was accepted after its Peer went quiet 3 times without handing back/);
  assert.match(deskFacts(ledgerOf([task({ id: "L1-T1", status: "merged", silent: 1 })]), READING)[0]!.fact.quote, /went quiet once without handing back/);

  // Still running, still being sent back, or cut: none of those is the Lead taking the work in.
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", handback: { file: "f", outcome: "blocked", summary: "s", at: 0 } })])), []);
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", status: "cut", handback: { file: "f", outcome: "blocked", summary: "s", at: 0 } })])), [], "cutting a task its Peer could not finish is the answer, not the fault");
});

test("an outcome word the schema does not offer reads as finished, and a lane names only its first few", () => {
  // `done` stores any string unvalidated, so a stray word falls the safe way: silence.
  assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", status: "merged", handback: { file: "f", outcome: "completed", summary: "s", at: 0 } })])), []);

  const many = ledgerOf(Array.from({ length: 7 }, (_, index) => task({ id: `L1-T${index + 1}`, status: "merged", handback: { file: "f", outcome: "partial", summary: "s", at: 0 } })));
  const quote = deskFacts(many, READING).find((seen) => seen.fact.kind === "accepted-unfinished")!.fact.quote;
  assert.match(quote, /; and 2 more in this lane$/);
  assert.ok(!quote.includes("L1-T6"), "a lane's accepted tasks only accumulate, so the quote does not grow with them");
});

test("a brief is not read as prewritten for stating acceptance, narrowing scope or quoting a failure", () => {
  // Written exactly as LEAD.md asks: acceptance as behaviours, context carrying settled facts.
  const asked = ledgerOf([
    task({
      id: "L1-T1",
      context: "Acceptance behaviours:\n1. A 10% code lowers the total.\n2. The receipt shows the rate.\nThe rate table is in src/pricing.ts; the export map there is settled, so do not widen it.",
    }),
  ]);
  assert.deepEqual(kinds(asked), []);
  assert.equal(prewritten("It currently fails with:\n```\nAssertionError: 1 !== 2 at test/pricing.test.ts:14\n```\nFind out why."), false, "a quoted failure is evidence, not an answer");
  assert.equal(prewritten("Here is the shape:\n```ts\nexport function applyCode() {}\n```"), true, "code in a brief is the answer, typed out");
});

test("a review focus is not read as timid for narrowing scope or asking for rigour", () => {
  const focus = (goal: string) => kinds(ledgerOf([task({ id: "L1-R1", kind: "review", of: "L1-T1", goal })]));
  assert.deepEqual(focus("Review only the merge path, and make sure the lock is released on every branch."), [], "narrowing the scope asks for more rigour, not less");
  assert.deepEqual(focus("Read just the new module; I am not sure the rounding is right."), [], "the Lead's own doubt is not an instruction to withhold");
  assert.deepEqual(focus("Report only what you can prove."), ["certainty-only"]);
  assert.deepEqual(focus("Nothing speculative; list only high-confidence findings."), ["certainty-only"]);
  assert.deepEqual(focus("Do not report anything unless you are certain of it."), ["certainty-only"]);
});
