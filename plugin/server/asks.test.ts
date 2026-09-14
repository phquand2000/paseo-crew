import assert from "node:assert/strict";
import { test } from "node:test";
import { dropAgent, dueReminders, markReminded, settle } from "./asks.ts";

test("settle opens new requests, keeps repeated ones and closes the rest", () => {
  const first = settle([], "lead-1", "Lead A", [{ kind: "NEED", text: "NEED: a build slot" }], 1000);
  assert.equal(first.opened.length, 1);
  assert.equal(first.asks.length, 1);

  const again = settle(first.asks, "lead-1", "Lead A", [{ kind: "NEED", text: "NEED: a build slot" }], 5000);
  assert.equal(again.opened.length, 0);
  assert.equal(again.asks[0]?.openedAt, 1000);

  const cleared = settle(again.asks, "lead-1", "Lead A", [], 9000);
  assert.equal(cleared.closed.length, 1);
  assert.equal(cleared.asks.length, 0);
});

test("settle leaves other agents' requests untouched", () => {
  const a = settle([], "lead-1", "A", [{ kind: "BLOCKED", text: "BLOCKED: docker" }], 1).asks;
  const b = settle(a, "lead-2", "B", [{ kind: "NEED", text: "NEED: x" }], 2).asks;
  const closed = settle(b, "lead-2", "B", [], 3);
  assert.deepEqual(
    closed.asks.map((ask) => ask.agentId),
    ["lead-1"],
  );
});

test("reminders fall due after the interval and stop at the limit", () => {
  let asks = settle([], "lead-1", "A", [{ kind: "NEED", text: "NEED: x" }], 0).asks;
  assert.equal(dueReminders(asks, 10, 100, 2).length, 0);
  assert.equal(dueReminders(asks, 100, 100, 2).length, 1);
  const id = new Set([asks[0]!.id]);
  asks = markReminded(asks, id, 100);
  assert.equal(dueReminders(asks, 150, 100, 2).length, 0);
  asks = markReminded(asks, id, 200);
  assert.equal(dueReminders(asks, 1000, 100, 2).length, 0);
  assert.equal(dropAgent(asks, "lead-1").length, 0);
});
