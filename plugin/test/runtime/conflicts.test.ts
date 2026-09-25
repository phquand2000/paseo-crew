import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../tempdir.ts";
import { harness, laneWithPeer } from "./harness.ts";

const scope = { outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["the rest"] };

/** A lane with one commit to a.txt, reported ready, while main takes another change to the same line. */
async function laneAgainstMain(isolate: boolean) {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", ...scope, writeSet: ["a.txt"], isolate });
  const lane = h.ledger().lanes.L1!;
  h.commit(lane.worktree!, "a.txt", "one\nlane side\nthree\n");
  await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  h.agents.get(lane.lead!)!.status = "idle";
  // main moves on, as the Human's own work would: in their copy, or beside it while a lane holds it.
  const aside = isolate ? h.root : join(tempDir("sw2-main-"), "copy");
  if (!isolate) h.git(h.root, "worktree", "add", "-q", aside, "main");
  h.commit(aside, "a.txt", "one\nmain side\nthree\n");
  if (!isolate) h.git(h.root, "worktree", "remove", "--force", aside);
  return { h, sup, lane, land: () => h.call(sup, "supervisor", "land_lane", { lane: "L1" }) };
}

const underWay = (h: ReturnType<typeof harness>, copy: string) => existsSync(join(h.git(copy, "rev-parse", "--absolute-git-dir").trim(), "MERGE_HEAD"));

test("a base that conflicts with a lane is merged in as far as git goes and left for a Peer to settle, since no seat may run git merge", async () => {
  const { h, lane, land } = await laneAgainstMain(true);
  const refused = await land();
  assert.equal(refused.ok, false, refused.text);
  assert.match(refused.text, /Lane L1 was not closed: main has moved on and conflicts with lane\/l1-cart in a\.txt\. The merge is left in the lane's copy, and its Lead has a letter to have it settled/);
  assert.ok(underWay(h, lane.worktree!), "the conflicts wait in the lane's copy");
  assert.equal(h.ledger().lanes.L1!.ready, undefined, "what it was reported ready as is not what it holds now");
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /BASE CONFLICT L1 \(Cart\): main moved on, and merging it into lane\/l1-cart stopped on conflicts in a\.txt\. The merge is left in your working copy, and landing waits for it\.\n\nNext: add_tasks one task owning those files to settle them and commit the merge with git commit/);
  assert.match((await land()).text, /the merge of main into lane\/l1-cart left in its copy is not settled yet/, "a second landing leaves what is being settled alone");
  assert.ok(underWay(h, lane.worktree!));

  // As a Peer settles it: the file as it should be, then git commit.
  writeFileSync(join(lane.worktree!, "a.txt"), "one\nboth sides\nthree\n");
  h.git(lane.worktree!, "commit", "-qam", "Settle main into the lane");
  await h.call(lane.lead!, "lead", "report", { summary: "settled", ready: true });
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.equal(h.git(h.root, "show", "main:a.txt"), "one\nboth sides\nthree\n");
});

test("a lane dropped with a base merge left unsettled in the Human's own copy gives the copy back clean, on its base", async () => {
  const { h, sup, land } = await laneAgainstMain(false);
  assert.match((await land()).text, /conflicts with lane\/l1-cart in a\.txt/);
  assert.ok(underWay(h, h.root));
  const dropped = await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted after all" });
  assert.equal(dropped.ok, true, dropped.text);
  await h.idle(h.ledger().lanes.L1!.lead!);
  await h.runtime.desk.settled(h.project);
  await h.tick();
  assert.equal(underWay(h, h.root), false, "the desk undid the merge it began");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
  assert.equal(h.git(h.root, "status", "--porcelain"), "");
  assert.equal(h.git(h.root, "show", "lane/l1-cart:a.txt"), "one\nlane side\nthree\n", "and the lane's own work is kept on its branch");
});

test("a parallel task that conflicts with its lane at merge has the lane brought into its own copy for its Peer to settle, then merges", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Two", ...scope, writeSet: ["a.txt", "b.txt"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "b", title: "B", goal: "g", acceptance: ["a"], outOfScope: ["the rest"], holds: ["b.txt"], parallel: true }] });
  const task = h.ledger().tasks["L1-T1"]!;
  h.commit(task.worktree!, "b.txt", "task side\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "b" });
  // The lane moves on between its hand-back and its merge.
  h.commit(lane.worktree!, "b.txt", "lane side\n");
  h.agents.get(task.peer!)!.status = "idle";
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "rework");
  assert.equal(h.git(lane.worktree!, "show", "HEAD:b.txt"), "lane side\n", "the lane branch is unchanged");
  assert.ok(underWay(h, task.worktree!), "the conflicts wait in the task's own copy");
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /MERGE CONFLICT L1-T1 \(B\) with lane\/l1-two\.\nFiles: b\.txt\nThe lane branch is unchanged\. The desk began merging lane\/l1-two into the task's branch in its own copy and left the conflicts there\.\n\nNext: Send rework asking its Peer to settle them and commit the merge with git commit/);

  // As its Peer settles it and hands back, and its Lead accepts it again.
  writeFileSync(join(task.worktree!, "b.txt"), "both sides\n");
  h.git(task.worktree!, "commit", "-qam", "Settle the lane into the task");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "settled" });
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.equal(h.git(lane.worktree!, "show", "HEAD:b.txt"), "both sides\n");
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.at(-1) ?? "", /MERGED L1-T1 \(B\) into the lane branch\.[^]*Next: Every task of the lane is settled/, "the lane's last task merged wakes its Lead to have the lane reviewed and reported");
});

test("a parallel task accepted with nothing committed merges as the nothing it is, and its Peer stays with its copy until released", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Probe", ...scope, isolate: true });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "p", title: "Look", goal: "g", acceptance: ["a"], outOfScope: ["the rest"], holds: ["b.txt"], parallel: true }] });
  const task = h.ledger().tasks["L1-T1"]!;
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "nothing needed changing" });
  h.agents.get(task.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged", "the Lead accepted it, and the desk does not take that back");
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.at(-1) ?? "", /MERGED L1-T1 \(Look\): it changed no files, so there was nothing to merge\./);
  assert.equal(h.agents.get(task.peer!)!.archivedAt, null, "its Peer stays with its copy, as after any merge, until its Lead releases it");
});

test("a parallel task accepted while the lane's copy has work uncommitted waits in the queue, and merges once a turn ends with the copy clean", async () => {
  const { h, lane, peer } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "s", title: "Side", goal: "g", acceptance: ["c"], holds: ["c.txt"], outOfScope: ["the rest"], parallel: true }] });
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "C\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  writeFileSync(join(lane.worktree!, "a.txt"), "half written\n");
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  const waits = h.ledger().tasks["L1-T2"]!;
  assert.equal(waits.status, "queued", "the Lead accepted it, and a copy busy for now does not take that back");
  assert.match(waits.held?.why ?? "", /a\.txt/);
  assert.match(h.heard(lane.lead!).join("\n"), /MERGE WAITS L1-T2 \(Side\): the lane's working copy has uncommitted changes \(M a\.txt\), and L1-T1 holds it\. It merges by itself once that work is committed\.\n\nNext: Nothing now: MERGED arrives as mail, and cut withdraws the task\./);

  await h.endTurn(lane.lead!, "nothing yet");
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "queued", "tried again at a turn's end, and the copy is still busy");
  assert.equal(h.heard(lane.lead!).join("\n").match(/MERGE WAITS L1-T2/g)?.length, 1, "told once, not at every try");

  h.commit(lane.worktree!, "a.txt", "whole\n");
  await h.endTurn(peer, "committed a.txt");
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(h.ledger().tasks["L1-T2"]!.held, undefined);
  assert.equal(h.git(lane.worktree!, "show", "HEAD:c.txt"), "C\n");
});

test("landing a lane while an accepted task waits on its copy tries that merge once more first, so the accepted work lands with it", async () => {
  const { h, sup, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "s", title: "Side", goal: "g", acceptance: ["c"], holds: ["c.txt"], outOfScope: ["the rest"], parallel: true }] });
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "C\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  writeFileSync(join(lane.worktree!, "a.txt"), "half written\n");
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "queued");
  h.commit(lane.worktree!, "a.txt", "whole\n");
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(landed.ok, true, landed.text);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged", "no turn ended since the copy came clean, and landing does not cut what was accepted");
  assert.equal(h.git(h.root, "show", "main:c.txt"), "C\n");
});
