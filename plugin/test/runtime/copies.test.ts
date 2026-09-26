import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { harness } from "./harness.ts";

test("parallel work needs independent write sets and merges back from its own working copy", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Two files", outcome: "both change", acceptance: ["a", "b"], outOfScope: ["anything else in the repository"], writeSet: ["a.txt", "b.txt"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const serial = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Lock", goal: "g", acceptance: ["a"], holds: ["package-lock.json"], outOfScope: ["the rest of the repository"], parallel: true }] });
  assert.equal(serial.ok, false, "the lock file is really in this repository, so a parallel task may not hold it");
  const par = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "B", goal: "g", acceptance: ["b"], holds: ["b.txt"], outOfScope: ["the rest of the repository"], parallel: true }] });
  assert.equal(par.ok, true, par.text);
  const overlap = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "B again", goal: "g", acceptance: ["b"], holds: ["b.txt"], outOfScope: ["the rest of the repository"], parallel: true }] });
  assert.equal(overlap.ok, false);
  assert.match(overlap.text, /T holds b\.txt, which L1-T2 holds and is still writing, and does not wait for it/);
  const taskB = h.ledger().tasks["L1-T2"]!;
  assert.equal(taskB.slot, "S0", "the lane itself is in place, so the parallel task takes the first working copy the desk makes");
  assert.equal(h.agents.get(taskB.peer!)!.cwd, h.ledger().slots.S0!.path);

  const taskA = h.ledger().tasks["L1-T1"]!;
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(taskA.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(taskA.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);

  h.commit(taskB.worktree!, "b.txt", "B\n");
  await h.call(taskB.peer!, "peer", "done", { outcome: "complete", summary: "b" });
  h.agents.get(taskB.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(h.git(lane.worktree!, "show", "HEAD:b.txt"), "B\n");
  assert.deepEqual(Object.keys(h.ledger().slots), [taskB.slot], "the copy a parallel task opened stays with its Peer once its work is in, until its Lead releases it");

  const clash = await h.call(sup, "supervisor", "open_lane", { title: "C", outcome: "c", acceptance: ["c"], outOfScope: ["anything else in the repository"], writeSet: ["b.txt"] });
  assert.equal(clash.ok, false);
  assert.match(clash.text, /overlaps lane L1/, "two lanes that declared the same file are one lane, whichever copy each of them writes in");
  const fine = await h.call(sup, "supervisor", "open_lane", { title: "C", outcome: "c", acceptance: ["c"], outOfScope: ["anything else in the repository"], writeSet: ["c.txt"], isolate: true });
  assert.equal(fine.ok, true, fine.text);
  assert.ok(h.ledger().lanes.L2!.slot, "L1 is writing in the project's own copy, so the next lane is given one instead of switching the branch under it");
});

test("a lane that declared no write set does not lock the project to one lane, and where the next one works is the Supervisor's call", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };

  // The first lane is allowed to open with no write set, and takes the project's own copy.
  const first = await h.call(sup, "supervisor", "open_lane", { title: "Authorization", outcome: "roles gate the api", acceptance: ["a"], ...scope });
  assert.equal(first.ok, true, first.text);

  // One checkout is one branch: the desk names both ways and takes neither for the Supervisor.
  const asked = { title: "Authentication", outcome: "sessions exist", acceptance: ["a"], writeSet: ["src/auth/**"], ...scope };
  const refused = await h.call(sup, "supervisor", "open_lane", asked);
  assert.match(refused.text, /Lane L1 is working in the project's own copy on lane\/l1-authorization\. Pass isolate to open this lane in a copy of its own now, or open it with after L1/);
  assert.equal(Object.keys(h.ledger().lanes).length, 1, "nothing is recorded for a lane that did not open");
  const next = await h.call(sup, "supervisor", "open_lane", { ...asked, isolate: true });
  assert.equal(next.ok, true, next.text);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), h.ledger().lanes.L1!.branch, "the project's own copy stays on the lane it is carrying");

  // The DETOUR of the concept: a hole found mid-lane gets its own Lead, and a copy of its own without asking, since it cannot wait.
  const detour = await h.call(sup, "supervisor", "open_lane", { title: "Sessions", outcome: "sessions last a day", acceptance: ["a"], detourOf: "L1", ...scope });
  assert.equal(detour.ok, true, detour.text);
  const lanes = h.ledger().lanes;
  assert.equal(Object.values(lanes).filter((lane) => lane.status === "open").length, 3);
  const where = [lanes.L1!, lanes.L2!, lanes.L3!].map((lane) => h.agents.get(lane.lead!)!.cwd);
  assert.equal(new Set(where).size, 3, "no two Leads are left writing in one checkout");
});

test("a detour hands back to the lane that was waiting on it, and cannot be opened for a lane that is not", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Checkout", outcome: "an order can be paid for", acceptance: ["a"], ...scope });
  const waiting = h.ledger().lanes.L1!;

  const nowhere = await h.call(sup, "supervisor", "open_lane", { title: "Money type", outcome: "money is not a float", acceptance: ["a"], detourOf: "L7", ...scope });
  assert.equal(nowhere.ok, false, "a detour for a lane that does not exist is a letter with nowhere to go");

  const detour = await h.call(sup, "supervisor", "open_lane", { title: "Money type", outcome: "money is not a float", acceptance: ["a"], detourOf: "l1", ...scope });
  assert.equal(detour.ok, true, detour.text);
  const lane = h.ledger().lanes.L2!;
  assert.equal(lane.detourOf, "L1");
  assert.match(h.agents.get(lane.lead!)!.prompt!, /clears the way for L1/, "the detour's Lead is told to do that and no more");

  h.commit(lane.worktree!, "money.ts", "export type Money = bigint;\n");
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L2" });
  assert.equal(landed.ok, true, landed.text);
  await h.idle(waiting.lead!);
  assert.match(h.agents.get(waiting.lead!)!.sent.join("\n"), /CLEARED L2[\s\S]*Next: Read what it did before you go on; ask if your work needs it on your branch\./, "the lane that waited cannot see the other one, so it has to be told");
});

test("a detour dropped without landing tells the lane that waited on it that the way is not cleared", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Checkout", outcome: "an order can be paid for", acceptance: ["a"], ...scope });
  const waiting = h.ledger().lanes.L1!;
  await h.call(sup, "supervisor", "open_lane", { title: "Money type", outcome: "money is not a float", acceptance: ["a"], detourOf: "L1", ...scope });
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L2", reason: "the float stays for now" })).ok, true);
  await h.idle(waiting.lead!);
  const told = h.agents.get(waiting.lead!)!.sent.join("\n");
  assert.match(told, /DETOUR DROPPED L2 \(Money type\), the detour your lane L1 was waiting on: it closed without landing, and its branch lane\/l2-money-type is kept\.\n\nNext: Go on without it; ask if your lane still needs what it was for\./);
  assert.doesNotMatch(told, /CLEARED/);
});

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

test("a lane closed in the project's own copy keeps that copy until its Lead stops, and the next lane waits for it or takes a copy of its own", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "First", outcome: "x", acceptance: ["a"], ...scope });
  const first = h.ledger().lanes.L1!;
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), first.branch);

  // Closed while its Lead is mid-turn, so putting the branch back waits for that Lead.
  const closed = await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "wrong outcome" });
  assert.equal(closed.ok, true, closed.text);
  assert.deepEqual(h.ledger().lanes.L1!.restoring!.writers, [first.lead!], "and the wait is on the record, not in memory");

  // Switched now, the first Lead's next commit would land on the next lane's branch.
  const asked = { title: "Second", outcome: "y", acceptance: ["a"], ...scope };
  assert.match((await h.call(sup, "supervisor", "open_lane", asked)).text, /Lane L1 is closed, but its Lead is still ending a turn in the project's own copy, which goes back to main when that turn ends\. Pass isolate/);
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /Lane L1 is closed, and its Lead is ending a turn in it; it goes back to main after\./);
  const next = await h.call(sup, "supervisor", "open_lane", { ...asked, isolate: true });
  assert.equal(next.ok, true, next.text);
  const second = h.ledger().lanes.L2!;
  assert.ok(second.slot, "in a copy of its own");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), first.branch, "the copy the first Lead is writing in is not moved under it");

  h.agents.get(first.lead!)!.status = "idle";
  await h.endTurn(first.lead!, "stopping");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main", "once it stops, the project's copy is back on its base");
  const copy = h.ledger().slots[second.slot]!.path;
  h.commit(copy, "a.txt", "L2 work\n");
  assert.equal(h.git(h.root, "log", "-1", "--format=%s", second.branch).trim(), "edit a.txt", "and L2's commits are on L2's branch");

  // And a Lead that never comes back at all: the round finishes what its turn was holding up.
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L2", reason: "done" })).ok, true);
  h.agents.get(second.lead!)!.archivedAt = new Date().toISOString();
  await h.tick(Date.now());
  assert.deepEqual(Object.keys(h.ledger().slots), [], "its copy is put away, not left behind for good");
});

test("a copy waiting on a seat that never ends its turn is put away in the round, not left for good", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Abandoned", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  const lane = h.ledger().lanes.L1!;
  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "the outcome was wrong" });
  await h.call(sup, "supervisor", "release", { lane: "L1" });
  assert.equal(existsSync(lane.worktree!), true, "the Lead is mid-turn, so the copy waits for it");
  assert.deepEqual(h.ledger().slots[lane.slot!]!.releasing!.writers, [lane.lead!], "and what it is waiting on is on the record, not only in memory");

  // The turn never ends: archived, crashed, or the desk restarted; nothing writes there any more.
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  await h.tick(Date.now());

  assert.equal(existsSync(lane.worktree!), false, "the round puts it away rather than leaving a copy and a workspace for good");
  assert.deepEqual(Object.keys(h.ledger().slots), []);
});

test("a copy two seats are writing in is put away by the last of them to stop, not the first", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Both in here", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "In the lane's copy", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;
  assert.equal(h.agents.get(task.peer!)!.cwd, lane.worktree, "a lane-mode Peer writes in the lane's own copy, beside its Lead");
  writeFileSync(join(lane.worktree!, "half-written.txt"), "the Peer is mid-sentence\n");

  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "the outcome was wrong" })).ok, true);
  const released = await h.call(sup, "supervisor", "release", { lane: "L1" });
  assert.match(released.text, new RegExp(`${lane.lead} and ${task.peer}`), "both are named, because both are still writing there");

  h.agents.get(task.peer!)!.status = "idle";
  await h.endTurn(task.peer!, "stopping");
  assert.equal(existsSync(join(lane.worktree!, "half-written.txt")), true, "the Peer stopped, and the Lead is still in there");
  assert.ok(h.ledger().slots[lane.slot!], "so the copy is still the lane's");

  h.agents.get(lane.lead!)!.status = "idle";
  await h.endTurn(lane.lead!, "stopping too");
  assert.equal(existsSync(lane.worktree!), false, "the last one out puts it away");
  assert.deepEqual(Object.keys(h.ledger().slots), []);
});

test("a hand-back the Lead has not accepted still holds the lane's copy, so nothing is sent in beside it", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["the rest of the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Two in a row", outcome: "a and b change", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A", goal: "g", acceptance: ["a"], hints: ["a.txt"], ...scope }] });
  const first = h.ledger().tasks["L1-T1"]!;
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(first.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(first.peer!)!.status = "idle";

  // Its Peer is still seated and rework would wake it in that directory, so the copy is not free yet.
  const second = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "B", goal: "g", acceptance: ["b"], hints: ["b.txt"], ...scope }] });
  assert.match(second.text, /L1-T2 B: held: L1-T1 has handed back and is waiting on you/);
  assert.equal(h.ledger().tasks["L1-T2"]!.peer, undefined, "nobody is sent into the copy beside it");

  // With the second task never started, the copy is clean and the first accepts as it always did; the second then starts.
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "running");

  // And a rework that would wake a Peer into another task's writing is refused, not prescribed.
  const back = await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "commit it" });
  assert.equal(back.ok, false);
  assert.match(back.text, /L1-T2 holds the lane's working copy/, "its Peer goes back to it only once the copy is free");
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "C", goal: "g", acceptance: ["c"], holds: ["c.txt"], ...scope, parallel: true }] });
  const par = Object.values(h.ledger().tasks).find((task) => task.title === "C")!;
  writeFileSync(join(lane.worktree!, "b.txt"), "half\n");
  const reworkPar = await h.call(lane.lead!, "lead", "rework", { task: par.id, text: "again" });
  assert.equal(reworkPar.ok, true, "a parallel task has a copy of its own, so its rework is nobody else's business");
});
