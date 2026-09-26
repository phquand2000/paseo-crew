import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../tempdir.ts";
import { harness } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };

/** Whether `check` comes true within `ms`, looked at every 20 ms. */
async function within(ms: number, check: () => boolean): Promise<boolean> {
  for (const end = Date.now() + ms; !check(); await new Promise((resolve) => setTimeout(resolve, 20)))
    if (Date.now() > end) return false;
  return true;
}

/** Two lanes, each with a task beside others handed back green; the first lane has moved, and its merge's gate waits on `go`. */
async function heldLanes(t: { after(fn: () => void): void }) {
  const signals = tempDir("sw2-queues-");
  const [armed, go] = [join(signals, "armed"), join(signals, "go")];
  // Let go of the held gate whatever the test found, or it would wait out the gate's timeout.
  t.after(() => writeFileSync(go, ""));
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", {
    gate: `if [ -f ${armed} ]; then while [ ! -f ${go} ]; do sleep 0.05; done; fi`,
    gateOn: "task",
  });
  for (const title of ["One", "Two"])
    await h.call(sup, "supervisor", "open_lane", { title, outcome: title, ...scope, isolate: true });
  const lanes = ["L1", "L2"].map((id) => h.ledger().lanes[id]!);
  for (const [index, lane] of lanes.entries()) {
    await h.call(lane.lead!, "lead", "add_tasks", {
      tasks: [{ key: "t", title: `Side ${index}`, goal: "g", ...scope, holds: [`s${index}.txt`], parallel: true }],
    });
    const task = h.ledger().tasks[`${lane.id}-T1`]!;
    h.commit(task.worktree!, `s${index}.txt`, "s\n");
    assert.equal((await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "s" })).ok, true);
    h.agents.get(task.peer!)!.status = "idle";
  }
  h.commit(lanes[0]!.worktree!, "moved.txt", "moved\n");
  writeFileSync(armed, "");
  await h.call(lanes[0]!.lead!, "lead", "accept", { task: "L1-T1" });
  assert.ok(await within(5000, () => h.ledger().tasks["L1-T1"]!.status === "merging"));
  return { h, lanes, go };
}

test("each lane merges in its own queue: a gate running on one lane's merge holds no other lane's", async (t) => {
  const { h, lanes, go } = await heldLanes(t);
  await h.call(lanes[1]!.lead!, "lead", "accept", { task: "L2-T1" });
  assert.ok(
    await within(5000, () => h.ledger().tasks["L2-T1"]!.status === "merged"),
    "the second lane's merge went by while the first lane's gate ran",
  );
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merging");
  writeFileSync(go, "");
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
});

test("taking a lane's queue up again as a turn ends never mistakes another lane's merge under way for one a stop cut off", async (t) => {
  const { h, lanes, go } = await heldLanes(t);
  const busy = join(lanes[1]!.worktree!, "a.txt");
  writeFileSync(busy, "being written\n");
  await h.call(lanes[1]!.lead!, "lead", "accept", { task: "L2-T1" });
  assert.ok(
    await within(5000, () => h.ledger().tasks["L2-T1"]!.held !== undefined),
    "it waits for the second lane's copy",
  );
  h.git(lanes[1]!.worktree!, "checkout", "--", "a.txt");
  void h.runtime.desk.resumeMerges(h.project);
  assert.ok(await within(5000, () => h.ledger().tasks["L2-T1"]!.status === "merged"));
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merging", "the first lane's merge is still its own, running");
  writeFileSync(go, "");
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
});
