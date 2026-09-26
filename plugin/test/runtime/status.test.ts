import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a seat asking for status again with nothing changed is told to end its turn, and sees the page again once something has", async (t) => {
  const { h, sup, lane } = await laneWithPeer();
  // The page is stamped to the minute, and these calls must not straddle one.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const status = (seat: string, role: string) => h.call(seat, role, "status", {});
  assert.match((await status(lane.lead!, "lead")).text, /L1-T1/);
  assert.equal((await status(lane.lead!, "lead")).text, "Nothing has changed since you last asked: end your turn, and mail wakes you when something does.");
  assert.match((await status(sup, "supervisor")).text, /Lane L1/, "each seat is judged by what it was shown itself");

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Receipt", goal: "g", acceptance: ["a"], owned: ["b.txt"], outOfScope: ["the rest"], parallel: true }] });
  assert.match((await status(lane.lead!, "lead")).text, /L1-T2/, "a new task is a change");
});
