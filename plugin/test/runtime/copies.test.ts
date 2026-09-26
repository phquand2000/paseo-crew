import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { harness } from "./harness.ts";

/** Three lanes as a run opens them: the first in the project's own copy, the other two in copies of their own. */
async function threeLanes(gate: string) {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate });
  const scope = { outOfScope: ["anything else in the repository"] };
  for (const [title, path] of [["Part A", "a/**"], ["Part B", "b/**"], ["Part C", "c/**"]] as const) {
    const opened = await h.call(sup, "supervisor", "open_lane", { title, outcome: title, acceptance: ["done"], writeSet: [path], isolate: title !== "Part A", ...scope });
    assert.equal(opened.ok, true, opened.text);
  }
  const lanes = h.ledger().lanes;
  for (const lane of Object.values(lanes)) h.agents.get(lane.lead!)!.status = "idle";
  const work = (lane: { worktree?: string }, file: string, text = `${file}\n`) => {
    mkdirSync(join(lane.worktree!, dirname(file)), { recursive: true });
    writeFileSync(join(lane.worktree!, file), text);
    h.git(lane.worktree!, "add", "-A");
    h.git(lane.worktree!, "commit", "-qm", file);
  };
  return { h, sup, lanes, work };
}

test("a lane lands after another lane moved main, even while a third holds the project's own copy", async () => {
  const { h, sup, lanes, work } = await threeLanes("true");
  assert.equal(lanes.L1!.slot, undefined, "the first lane works in the project's own copy");
  work(lanes.L2!, "b/b.txt");
  work(lanes.L3!, "c/c.txt");

  const third = await h.call(sup, "supervisor", "land_lane", { lane: "L3" });
  assert.equal(third.ok, true, third.text);
  // main moved on and the only copy on it carries L1, yet L2 must still be landed, not closed unlanded.
  const second = await h.call(sup, "supervisor", "land_lane", { lane: "L2" });
  assert.equal(second.ok, true, second.text);
  assert.doesNotMatch(second.text, /not landed/);
  assert.equal(h.git(h.root, "show", "main:b/b.txt"), "b/b.txt\n");
  assert.equal(h.git(h.root, "show", "main:c/c.txt"), "c/c.txt\n");
  for (const id of ["L2", "L3"]) assert.equal((await h.call(sup, "supervisor", "release", { lane: id })).ok, true);
  assert.equal(h.git(h.root, "branch", "--list", lanes.L2!.branch, lanes.L3!.branch).trim(), "", "landed branches go with their copies, once their Leads are released");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), lanes.L1!.branch, "the lane in the project's own copy is not moved for it");
  assert.equal(h.ledger().lanes.L1!.status, "open");
});

test("the gate that lets a lane land runs on the lane with main's newer work in it", async () => {
  const { h, sup, lanes, work } = await threeLanes("test ! -f b/b.txt || test -f c/c.txt");
  work(lanes.L2!, "b/b.txt");
  work(lanes.L3!, "c/c.txt");
  assert.equal((await h.call(sup, "supervisor", "land_lane", { lane: "L3" })).ok, true);
  const second = await h.call(sup, "supervisor", "land_lane", { lane: "L2" });
  assert.equal(second.ok, true, second.text);
  assert.equal(h.git(h.root, "show", "main:b/b.txt"), "b/b.txt\n");
});
