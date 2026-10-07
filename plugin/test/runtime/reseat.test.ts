import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a Lead reseats a task: a fresh Peer carries on in the same copy and branch, and one holding nothing it may not", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const archive = (id: string) =>
    Object.assign(h.agents.get(id)!, { archivedAt: new Date().toISOString(), status: "closed" });
  const reseat = (task: string, why: string) => h.call(lead, "lead", "reseat", { task, why });

  h.commit(lane.worktree!, "a.txt", "first half\n");
  const kept = h.git(lane.worktree!, "rev-parse", "HEAD").trim();
  await h.call(peer, "peer", "done", { outcome: "partial", summary: "Half of it: the second half is left." });
  const first = await reseat("L1-T1", "It stopped halfway; finish the second half.");
  assert.equal(first.ok, true, first.text);
  const fresh = h.ledger().tasks["L1-T1"]!.peer!;
  assert.notEqual(fresh, peer);
  assert.ok(h.agents.get(peer)!.archivedAt, "one Peer at a time: the last one is let go");
  assert.equal(h.ledger().agents[peer]!.gone, true);
  assert.deepEqual(h.ledger().agents[fresh], { id: fresh, role: "peer", lane: "L1", task: "L1-T1" });
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "rework", "its hand-back no longer stands");
  const seated = h.agents.get(fresh)!;
  assert.equal(seated.cwd, lane.worktree);
  assert.equal(h.git(lane.worktree!, "branch", "--show-current").trim(), h.ledger().tasks["L1-T1"]!.branch);
  assert.equal(
    h.git(lane.worktree!, "rev-parse", "HEAD").trim(),
    kept,
    "what the last Peer committed is where it goes on",
  );
  assert.match(
    seated.prompt ?? "",
    /You take over L1-T1 from the engineer who worked it before you: It stopped halfway; finish the second half\.\nIts branch and copy hold what that engineer committed and left: read git log, git status and git diff [0-9a-f]+ before you change anything/,
  );
  assert.match(
    seated.prompt ?? "",
    /<record>\n# L1-T1 Clean build[\s\S]*Half of it: the second half is left\.[\s\S]*<\/record>/,
  );

  archive(fresh);
  await h.tick(Date.now());
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  const again = await reseat("L1-T1", "Its agent was closed.");
  assert.equal(again.ok, true, again.text);
  const third = h.ledger().tasks["L1-T1"]!;
  assert.equal(third.status, "running", "a task whose Peer was lost runs again");
  assert.equal(third.peerGone, undefined);

  archive(third.peer!);
  await h.tick(Date.now());
  await h.call(lead, "lead", "add_tasks", {
    tasks: [{ key: "u", title: "Next", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] }],
  });
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "running", "the lost Peer's copy went to the next task");
  const before = h.ledger();
  const held = await reseat("L1-T1", "Carry on.");
  assert.equal(held.ok, false);
  assert.match(held.text, /L1-T2 holds the lane's working copy now/);
  assert.deepEqual(h.ledger().tasks, before.tasks, "refused, nothing moved");
  assert.deepEqual(h.ledger().agents, before.agents);

  await h.call(lead, "lead", "start_review", { focus: "the lane as a whole" });
  assert.match((await reseat("L1-R1", "Read it again.")).text, /L1-R1 is a review: cut it and start_review again/);
});
