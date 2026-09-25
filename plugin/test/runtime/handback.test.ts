import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a task beside others is read from where its branch left the lane's, not from where the lane stands now", async () => {
  const { h, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Side", goal: "g", acceptance: ["a"], holds: ["c.txt"], outOfScope: ["the rest"], parallel: true }] });
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "C\n");
  h.commitTo(lane.branch, "a.txt", "moved on\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  await h.idle(lane.lead!);
  const handback = h.agents.get(lane.lead!)!.sent.join("\n").split("HANDBACK L1-T2")[1] ?? "";
  assert.match(handback, /\nChanged: c\.txt\n/);
  assert.doesNotMatch(handback, /Note:/, "a.txt moved on the lane, not in this task's copy");
});

test("a task in the lane's copy is read from where its branch meets the lane's, not with what a task beside it merged into the lane meanwhile", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  await h.call(sup, "supervisor", "set_project", { riskRules: [{ paths: ["c.txt"], invariant: "c stays c", reviewQuestion: "Does c stay c?" }] });
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "s", title: "Side", goal: "g", acceptance: ["c"], holds: ["c.txt"], outOfScope: ["the rest"], parallel: true }] });
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "C\nC\nC\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged", "merged into the lane's copy, where L1-T1 still works");
  h.commit(lane.worktree!, "a.txt", "A2\n");

  assert.equal((await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" })).ok, true);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n").split("HANDBACK L1-T1")[1] ?? "", /\nChanged: a\.txt\n/, "c.txt came in with L1-T2's merge, not from this Peer");

  assert.equal((await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is a right?" })).ok, true);
  assert.equal(h.ledger().tasks["L1-R1"]!.asked, undefined, "the rule on c.txt asks L1-T2's reviews, not this one's");
  const reviewer = h.ledger().tasks["L1-R1"]!.peer!;
  const commit = h.ledger().tasks["L1-T1"]!.handback!.commit!;
  assert.match(h.agents.get(reviewer)!.prompt ?? "", new RegExp(`see it with git diff ${lane.branch}\\.\\.\\.${commit}\\.`), "read from where its branch meets the lane's, L1-T2's lines are not this task's");

  await h.idle(peer);
  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.match(accepted.text, /^L1-T1 is in the merge queue/);
  await h.runtime.desk.settled(h.project);
  await h.idle(lane.lead!);
  const merged = h.agents.get(lane.lead!)!.sent.join("\n").split("MERGED L1-T1")[1] ?? "";
  assert.match(merged, /Lines changed: source 0, tests 0, docs 4\./, "a.txt's three lines out and one in; c.txt's three are L1-T2's");
  assert.doesNotMatch(merged, /Note: (in what|outside)/);
});
