import assert from "node:assert/strict";
import { test } from "node:test";
import type { Lane } from "../../server/domain/lane.ts";
import { type Ledger, emptyLedger } from "../../server/domain/ledger.ts";
import type { Task } from "../../server/domain/task.ts";
import type { FactKind } from "../../server/runtime/watch/fact-kinds.ts";
import { deskFacts } from "../../server/runtime/watch/history.ts";

const READING = { reworksAt: 3 };

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

test("a lane's record shows one hole patched a task at a time, about its Lead, in words that change only with the evidence", () => {
  const spread = ledgerOf([1, 2, 3].map((n) => task({ id: `L1-T${n}`, reworks: 1 })));
  const rows: [string, Ledger, FactKind[]][] = [
    ["the same three spread over tasks is one hole patched a task at a time", spread, ["patched-not-fixed"]],
    ["one task sent back again and again is its Lead's own call", ledgerOf([task({ id: "L1-T1", reworks: 5 })]), []],
    ["two sendings-back is a correction", ledgerOf([1, 2].map((n) => task({ id: `L1-T${n}`, reworks: 1 }))), []],
    [
      "a lane with no Lead to be about",
      ledgerOf(
        [1, 2, 3].map((n) => task({ id: `L1-T${n}`, reworks: 1 })),
        { lead: undefined },
      ),
      [],
    ],
    [
      "a lane that is closed",
      ledgerOf(
        [1, 2, 3].map((n) => task({ id: `L1-T${n}`, reworks: 1 })),
        { status: "closed" },
      ),
      [],
    ],
    [
      "a task accepted or cut has stopped going round",
      ledgerOf([
        task({ id: "L1-T1", reworks: 2, status: "merged", handback: handback("complete") }),
        task({ id: "L1-T2", reworks: 2, status: "cut" }),
        task({ id: "L1-T3", reworks: 1 }),
      ]),
      [],
    ],
    [
      "taking in work its Peer handed back partial or blocked is the Lead's call, not a fact",
      ledgerOf([
        task({ id: "L1-T1", status: "merged", handback: handback("partial") }),
        task({ id: "L1-T2", status: "merged", handback: handback("blocked") }),
      ]),
      [],
    ],
  ];
  for (const [why, ledger, expected] of rows) assert.deepEqual(kinds(ledger), expected, why);

  const patched = quote(spread, "patched-not-fixed");
  assert.equal(patched.seat, "lead-1", "the Lead decides to send work back, so the Lead is who this is about");
  const first = patched.fact.quote;
  assert.match(first, /3 sendings-back across 3 tasks .*L1-T1 ×1, L1-T2 ×1, L1-T3 ×1/);
  assert.equal(
    quote(spread, "patched-not-fixed").fact.quote,
    first,
    "reading the same ledger twice says the same words",
  );
  spread.tasks["L1-T1"]!.reworks = 2;
  assert.notEqual(quote(spread, "patched-not-fixed").fact.quote, first, "a fourth sending-back is new evidence");
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
