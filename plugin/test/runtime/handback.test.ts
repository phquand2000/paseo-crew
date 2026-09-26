import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a Peer that changed files outside its owned paths is told so as it hands back, and its Lead reads it in the hand-back", async () => {
  const { h, lane, peer } = await laneWithPeer();
  h.commit(lane.worktree!, "a.txt", "A\n");
  h.commit(lane.worktree!, "b.txt", "B\n");
  const handed = await h.call(peer, "peer", "done", { outcome: "complete", summary: "a, and b on the way" });
  assert.match(handed.text, /^Handed back\. You changed b\.txt outside your owned paths; your Lead sees that with the hand-back\./);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /Discovered: nothing\nChanged outside its owned paths: b\.txt/);

  // A task beside it is measured from where its branch left the lane's, not from the lane's tip now.
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Side", goal: "g", acceptance: ["a"], owned: ["c.txt"], outOfScope: ["the rest"], parallel: true }] });
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "C\n");
  h.commit(lane.worktree!, "a.txt", "moved on\n");
  const clean = await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  assert.doesNotMatch(clean.text, /outside your owned paths/);
});

test("a task in the lane's copy is read by its own commits, not by what a task beside it had merged into that copy meanwhile", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  await h.call(sup, "supervisor", "set_project", { riskRules: [{ paths: ["c.txt"], invariant: "c stays c", reviewQuestion: "Does c stay c?" }] });
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "s", title: "Side", goal: "g", acceptance: ["c"], owned: ["c.txt"], outOfScope: ["the rest"], parallel: true }] });
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "C\nC\nC\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged", "merged into the lane's copy, where L1-T1 still works");
  h.commit(lane.worktree!, "a.txt", "A2\n");

  const handed = await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  assert.doesNotMatch(handed.text, /outside your owned paths/, "c.txt came in with L1-T2's merge, not from this Peer");
  await h.idle(lane.lead!);
  assert.doesNotMatch(h.agents.get(lane.lead!)!.sent.join("\n"), /Changed outside its owned paths/);

  assert.equal((await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is a right?" })).ok, true);
  assert.equal(h.ledger().tasks["L1-R1"]!.asked, undefined, "the rule on c.txt asks L1-T2's reviews, not this one's");
  const reviewer = h.ledger().tasks["L1-R1"]!.peer!;
  const start = h.ledger().tasks["L1-T1"]!.startSha!;
  const commit = h.ledger().tasks["L1-T1"]!.handback!.commit!;
  assert.match(h.agents.get(reviewer)!.prompt ?? "", new RegExp(`see it with git log -p --first-parent --no-merges ${start}\\.\\.${commit}\\.`), "a diff across the range would show L1-T2's lines as this task's");

  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.match(accepted.text, /its commits are already on/);
  await h.idle(lane.lead!);
  const merged = h.agents.get(lane.lead!)!.sent.join("\n").split("MERGED L1-T1")[1] ?? "";
  assert.match(merged, /Lines changed: source 0, tests 0, docs 4\./, "a.txt's three lines out and one in; c.txt's three are L1-T2's");
  assert.doesNotMatch(merged, /files outside the owned paths/);
});
