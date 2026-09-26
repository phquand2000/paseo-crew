import assert from "node:assert/strict";
import { test } from "node:test";
import type { Lane } from "../../server/domain/lane.ts";
import { type Ledger, emptyLedger } from "../../server/domain/ledger.ts";
import type { Task } from "../../server/domain/task.ts";
import type { FactKind } from "../../server/runtime/watch/facts.ts";
import { deskFacts } from "../../server/runtime/watch/history.ts";

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

const handback = (outcome: string) => ({ file: "f", outcome, summary: "s", at: 0 });

function ledgerOf(tasks: Task[], over: Partial<Lane> = {}): Ledger {
  const held = emptyLedger();
  held.lanes.L1 = lane(over);
  for (const entry of tasks) held.tasks[entry.id] = entry;
  return held;
}

const kinds = (ledger: Ledger) =>
  deskFacts(ledger, READING)
    .map((seen) => seen.fact.kind)
    .sort();

const quote = (ledger: Ledger, kind: FactKind) => deskFacts(ledger, READING).find((seen) => seen.fact.kind === kind)!;

test("a lane's record shows loops, patching, unfinished acceptance and unconverged reviews, about its Lead, in words that change only with the evidence", () => {
  const looping = ledgerOf([task({ id: "L1-T1", reworks: 3, handback: handback("partial") })]);
  const spread = ledgerOf([1, 2, 3].map((n) => task({ id: `L1-T${n}`, reworks: 1 })));
  const rounds = [1, 2, 3].map((n) =>
    task({ id: `L1-R${n}`, kind: "review", of: "L1-T1", title: `review ${n}`, handback: handback("changes") }),
  );
  const reviewed = ledgerOf([task({ id: "L1-T1" }), ...rounds]);
  const partial = ledgerOf([task({ id: "L1-T1", status: "merged", handback: handback("partial") })]);
  const rows: [string, Ledger, FactKind[]][] = [
    ["two sendings-back is a correction, not yet a loop", ledgerOf([task({ id: "L1-T1", reworks: 2 })]), []],
    ["a task sent back again and again is a loop", looping, ["rework-loop"]],
    ["the same three spread over tasks is one hole patched a task at a time", spread, ["patched-not-fixed"]],
    ["reviews piling up on one unsettled task", reviewed, ["reviews-unconverged"]],
    [
      "three rounds that ended in acceptance converged",
      ledgerOf([task({ id: "L1-T1", status: "merged", handback: handback("complete") }), ...rounds]),
      [],
    ],
    ["two reviews is a second opinion", ledgerOf([task({ id: "L1-T1" }), ...rounds.slice(0, 2)]), []],
    ["a lane with no Lead to be about", ledgerOf([task({ id: "L1-T1", reworks: 5 })], { lead: undefined }), []],
    ["a lane that is closed", ledgerOf([task({ id: "L1-T1", reworks: 5 })], { status: "closed" }), []],
    [
      "a task that was accepted has stopped going round",
      ledgerOf([task({ id: "L1-T1", reworks: 4, status: "merged", handback: handback("complete") })]),
      [],
    ],
    ["and one that was cut", ledgerOf([task({ id: "L1-T1", reworks: 4, status: "cut" })]), []],
    [
      "neither counts toward the lane's total",
      ledgerOf([
        task({ id: "L1-T1", reworks: 2, status: "merged", handback: handback("complete") }),
        task({ id: "L1-T2", reworks: 2 }),
      ]),
      [],
    ],
    ["a task taken in although its Peer handed it back partial", partial, ["accepted-unfinished"]],
    [
      "or blocked",
      ledgerOf([task({ id: "L1-T1", status: "merged", handback: handback("blocked") })]),
      ["accepted-unfinished"],
    ],
    [
      "a Peer that said it finished raises nothing",
      ledgerOf([task({ id: "L1-T1", status: "merged", handback: handback("complete") })]),
      [],
    ],
    ["a task still running is not taken in", ledgerOf([task({ id: "L1-T1", handback: handback("blocked") })]), []],
    [
      "cutting a task its Peer could not finish is the answer, not the fault",
      ledgerOf([task({ id: "L1-T1", status: "cut", handback: handback("blocked") })]),
      [],
    ],
  ];
  for (const [why, ledger, expected] of rows) assert.deepEqual(kinds(ledger), expected, why);

  const loop = quote(looping, "rework-loop");
  assert.equal(loop.seat, "lead-1", "the Lead decides to send it back, so the Lead is who this is about");
  assert.match(loop.fact.quote, /L1-T1 \(Apply discount\) has been sent back 3 times, last outcome partial/);
  assert.match(
    quote(spread, "patched-not-fixed").fact.quote,
    /3 sendings-back across 3 tasks .*L1-T1 ×1, L1-T2 ×1, L1-T3 ×1/,
  );
  assert.match(
    quote(reviewed, "reviews-unconverged").fact.quote,
    /3 reviews of L1-T1 .*which is running: changes, changes, changes/,
  );
  const unfinished = quote(partial, "accepted-unfinished");
  assert.match(unfinished.fact.quote, /L1-T1 \(Apply discount\) was accepted after its Peer handed it back partial/);
  assert.equal(unfinished.seat, "lead-1", "accepting is the Lead's act, so the Lead is who this is about");

  const held = ledgerOf([task({ id: "L1-T1", reworks: 3 })]);
  const first = quote(held, "rework-loop").fact.quote;
  assert.equal(quote(held, "rework-loop").fact.quote, first, "reading the same ledger twice says the same words");
  held.tasks["L1-T1"]!.reworks = 4;
  assert.notEqual(quote(held, "rework-loop").fact.quote, first, "a fourth sending-back is new evidence");
  // The book keys an incident by seat and kind, and the seat is the Lead, so one fact of a kind per lane.
  const two = ledgerOf([task({ id: "L1-T1", reworks: 3 }), task({ id: "L1-T2", reworks: 3 })]);
  const loops = deskFacts(two, READING).filter((seen) => seen.fact.kind === "rework-loop");
  assert.equal(loops.length, 1);
  assert.match(loops[0]!.fact.quote, /L1-T1 .*sent back 3 times.*; L1-T2 .*sent back 3 times/);

  const many = ledgerOf(
    Array.from({ length: 7 }, (_, index) =>
      task({ id: `L1-T${index + 1}`, status: "merged", handback: handback("partial") }),
    ),
  );
  const named = quote(many, "accepted-unfinished").fact.quote;
  assert.match(named, /; and 2 more in this lane$/);
  assert.ok(!named.includes("L1-T6"), "a lane's accepted tasks only accumulate, so the quote does not grow with them");
});

test("a brief that writes the work out, or a review told to report only certainties, is on the record, and ordinary wording is not", () => {
  const briefs: [string, FactKind[], string][] = [
    [
      "1. Create src/pricing.ts with a function applyCode\n2. Then add a test\n3. Then wire it in app.ts",
      ["brief-prewritten"],
      "steps that build the answer",
    ],
    ["The discount table lives in the pricing service; the Human wants stacking to stop.", [], "context"],
    ["", [], "an empty brief"],
    [
      "Totals must reflect the code. Acceptance: a 10% code lowers the total. You decide where it goes.",
      [],
      "a brief is judged by whether it hands over the answer, not by how long it is",
    ],
    [
      "Here is the shape:\n```ts\nexport function applyCode() {}\n```\nand 1. do this first",
      ["brief-prewritten"],
      "a code fence plus a step list is the answer, typed out",
    ],
    [
      "1. edit src/pricing.ts, exporting a const RATES",
      ["brief-prewritten"],
      "one step naming a file and a member is enough",
    ],
    ["The rounding rule is in RFC 1. Read it before you start.", [], "a reference is not a step"],
    [
      "Acceptance behaviours:\n1. A 10% code lowers the total.\n2. The receipt shows the rate.\nThe rate table is in src/pricing.ts; the export map there is settled, so do not widen it.",
      [],
      "acceptance and settled context written as LEAD.md asks",
    ],
    [
      "It currently fails with:\n```\nAssertionError: 1 !== 2 at test/pricing.test.ts:14\n```\nFind out why.",
      [],
      "a quoted failure is evidence, not an answer",
    ],
    [
      "Here is the shape:\n```ts\nexport function applyCode() {}\n```",
      ["brief-prewritten"],
      "code in a brief is the answer, typed out",
    ],
  ];
  for (const [context, expected, why] of briefs)
    assert.deepEqual(kinds(ledgerOf([task({ id: "L1-T1", context })])), expected, why);

  const focuses: [string, FactKind[], string][] = [
    ["Check the pricing change. Report only issues you are certain of.", ["certainty-only"], "certain"],
    ["Check the pricing change for correctness and rounding.", [], "an ordinary focus"],
    [
      "Review only the merge path, and make sure the lock is released on every branch.",
      [],
      "narrowing the scope asks for more rigour, not less",
    ],
    [
      "Read just the new module; I am not sure the rounding is right.",
      [],
      "the Lead's own doubt is not an instruction to withhold",
    ],
    ["Report only what you can prove.", ["certainty-only"], "prove"],
    ["Nothing speculative; list only high-confidence findings.", ["certainty-only"], "high-confidence"],
    ["Do not report anything unless you are certain of it.", ["certainty-only"], "unless certain"],
  ];
  for (const [goal, expected, why] of focuses)
    assert.deepEqual(kinds(ledgerOf([task({ id: "L1-R1", kind: "review", of: "L1-T1", goal })])), expected, why);
});
