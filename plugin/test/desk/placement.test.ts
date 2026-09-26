import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyLedger } from "../../server/desk/ledger.ts";
import { taskPlacement } from "../../server/desk/tasks/placement.ts";

const lane = {
  id: "L1",
  title: "Lane L1",
  outcome: "",
  acceptance: [],
  outOfScope: [],
  base: "main",
  branch: "lane-l1",
  writeSet: [],
  contracts: [],
  lead: "seat-lead",
  opener: "seat-sup",
  status: "open" as const,
  openedAt: 0,
  tasks: 2,
};

/** Why a task for the lane's copy is held while L1-T1 stands at `status` there. */
function heldBy(status: string): string | undefined {
  const ledger = emptyLedger();
  ledger.lanes.L1 = lane;
  ledger.tasks["L1-T1"] = {
    id: "L1-T1",
    lane: "L1",
    kind: "code",
    mode: "lane",
    title: "Task",
    goal: "",
    acceptance: [],
    hints: [],
    holds: [],
    outOfScope: [],
    peer: "seat-peer",
    status: status as never,
    openedAt: 0,
    updatedAt: 0,
    silent: 0,
  };
  return taskPlacement(ledger, lane, [], false, [])?.why;
}

test("a task for the lane's copy is told why the task there holds it, from where that task stands", () => {
  assert.match(heldBy("running") ?? "", /^L1-T1 is still writing in the lane's working copy/);
  assert.match(heldBy("done") ?? "", /^L1-T1 has handed back and is waiting on you/);
  assert.match(
    heldBy("failed") ?? "",
    /^L1-T1 failed to merge and is waiting on you, and it still holds the lane's working copy/,
  );
  assert.equal(heldBy("queued"), "L1-T1 is in the merge queue, and holds the lane's working copy until it merges.");
  assert.equal(heldBy("merging"), "L1-T1 is in the merge queue, and holds the lane's working copy until it merges.");
  assert.equal(heldBy("merged"), undefined);
});
