import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a task already cut is not cut again, so the lane's copy is not reset under the task writing in it now", async () => {
  const { h, lane } = await laneWithPeer();
  const copy = h.ledger().lanes.L1!.worktree!;
  assert.equal((await h.call(lane.lead!, "lead", "cut", { task: "L1-T1", reason: "wrong" })).ok, true);
  await h.call(lane.lead!, "lead", "add_tasks", {
    tasks: [
      {
        key: "t",
        title: "Again",
        goal: "g",
        acceptance: ["a"],
        hints: ["a.txt"],
        outOfScope: ["the rest of the repository"],
      },
    ],
  });
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "running");
  h.commit(copy, "a.txt", "the second task's work\n");

  const again = await h.call(lane.lead!, "lead", "cut", { task: "L1-T1", reason: "to be sure" });
  assert.equal(again.ok, false);
  assert.match(again.text, /^L1-T1 is already cut\.$/);
  assert.equal(readFileSync(join(copy, "a.txt"), "utf-8"), "the second task's work\n");
});
