import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { type harness, laneWithPeer } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

const task = (key: string, title: string, owned = "a.txt", extra: Record<string, unknown> = {}) => ({ key, title, goal: "g", acceptance: ["a"], owned: [owned], outOfScope: ["the rest of the repository"], ...extra });

/** The Peer commits `text` to `file` in the lane's copy and hands its task back, and the Lead accepts it. */
async function acceptWork(h: Harness, lead: string, peer: string, id: string, file = "a.txt", text = `${id}\n`) {
  h.commit(h.ledger().lanes.L1!.worktree!, file, text);
  const done = await h.call(peer, "peer", "done", { outcome: "complete", summary: text.trim() });
  assert.equal(done.ok, true, done.text);
  await h.idle(peer);
  const accepted = await h.call(lead, "lead", "accept", { task: id });
  assert.equal(accepted.ok, true, accepted.text);
  return accepted.text;
}

const live = (h: Harness) => [...h.agents.values()].filter((agent) => agent.provider.startsWith("sw2-peer-") && !agent.archivedAt).map((agent) => agent.id);

test("a Peer whose task is accepted stays until its Lead releases it, and never takes another task: the next one starts a Peer of its own", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  assert.equal((await h.call(lead, "lead", "add_tasks", { tasks: [task("u", "Second", "a.txt", { after: ["L1-T1"] })] })).ok, true);
  assert.match(await acceptWork(h, lead, peer, "L1-T1"), /Its Peer stays until you release it\./);
  const second = h.ledger().tasks["L1-T2"]!;
  assert.equal(second.status, "running");
  assert.notEqual(second.peer, peer, "a task never goes to a Peer that worked another");
  assert.deepEqual(live(h), [peer, second.peer], "and the Peer kept is not let go for it");
  assert.match(h.heard(lead).join("\n"), new RegExp(`Started L1-T2 in the lane's working copy on ${lane.branch} with Peer ${second.peer}\\.`));
  assert.match((await h.call(lead, "lead", "status", {})).text, new RegExp(`- L1-T1 Clean build: merged, hand-back \\d+ min ago; its Peer ${peer} idle \\d+ min is kept until you release it`));
});

test("Peers are kept one for each accepted task, each until its Lead releases it", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  await acceptWork(h, lead, peer, "L1-T1");
  await h.call(lead, "lead", "add_tasks", { tasks: [task("u", "Second")] });
  const second = h.ledger().tasks["L1-T2"]!.peer!;
  await acceptWork(h, lead, second, "L1-T2");
  assert.deepEqual(live(h), [peer, second]);
  const status = (await h.call(lead, "lead", "status", {})).text;
  for (const [id, seat] of [["L1-T1", peer], ["L1-T2", second]]) assert.match(status, new RegExp(`- ${id} [^:]+: merged, hand-back \\d+ min ago; its Peer ${seat} idle \\d+ min is kept until you release it`));
});

test("the Lead releases the Peer kept from an accepted task; not while the task runs", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  assert.match((await h.call(lead, "lead", "release", { task: "L1-T1" })).text, /L1-T1 is running: accept it first, or cut it, which stops its Peer\./);
  await acceptWork(h, lead, peer, "L1-T1");
  const released = await h.call(lead, "lead", "release", { task: "L1-T1" });
  assert.equal(released.ok, true, released.text);
  assert.match(released.text, /The Peer kept from L1-T1 is released\./);
  assert.ok(h.agents.get(peer)!.archivedAt);
  assert.match((await h.call(lead, "lead", "release", { task: "L1-T1" })).text, /The Peer kept from L1-T1 is gone already\./);

  await h.call(lead, "lead", "add_tasks", { tasks: [task("p", "Beside", "b.txt", { parallel: true })] });
  await h.call(lead, "lead", "start_review", { task: "L1-T2", focus: "Is it right?" });
  const review = Object.values(h.ledger().tasks).find((entry) => entry.kind === "review")!;
  assert.match((await h.call(lead, "lead", "release", { task: review.id })).text, new RegExp(`${review.id} is a review: its reviewer goes when you cut it\\.`));
});

test("a kept Peer the Human archives in Paseo is marked gone, and no longer shown as kept", async () => {
  const { h, lane, peer } = await laneWithPeer();
  await acceptWork(h, lane.lead!, peer, "L1-T1");
  const seat = h.agents.get(peer)!;
  seat.archivedAt = new Date().toISOString();
  await h.runtime.archived({ id: peer, provider: seat.provider, cwd: seat.cwd, title: seat.title });
  assert.equal(h.ledger().agents[peer]!.gone, true);
  assert.doesNotMatch((await h.call(lane.lead!, "lead", "status", {})).text, /is kept until you release it/);
});

test("a kept Peer released while it ends a turn is not shown as kept, though Paseo lists it until that turn ends", async () => {
  const { h, lane, peer } = await laneWithPeer();
  await acceptWork(h, lane.lead!, peer, "L1-T1");
  h.agents.get(peer)!.status = "running";
  assert.equal((await h.call(lane.lead!, "lead", "release", { task: "L1-T1" })).ok, true);
  assert.equal(h.agents.get(peer)!.archivedAt, null, "archived once its turn ends, not under it");
  assert.doesNotMatch((await h.call(lane.lead!, "lead", "status", {})).text, /is kept until you release it/);
});

/** A parallel task beside L1-T1, committed in its own copy, handed back, accepted and merged into the lane. */
async function mergedBeside(h: Harness, lead: string) {
  await h.call(lead, "lead", "add_tasks", { tasks: [task("p", "Beside", "b.txt", { parallel: true })] });
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "b.txt", "B\n");
  assert.equal((await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "b" })).ok, true);
  await h.idle(side.peer!);
  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  return h.ledger().tasks["L1-T2"]!;
}

test("a parallel task's Peer stays in its own copy once merged, until its Lead releases it and the copy goes with its branch", async () => {
  const { h, lane } = await laneWithPeer();
  const lead = lane.lead!;
  const side = await mergedBeside(h, lead);
  assert.equal(h.agents.get(side.peer!)!.archivedAt, null, "the merge does not let it go: its Lead does");
  assert.ok(existsSync(side.worktree!), "and it keeps the copy it works in");
  assert.match((await h.call(lead, "lead", "status", {})).text, new RegExp(`- L1-T2 Beside: merged[^\\n]*; its Peer ${side.peer} idle \\d+ min is kept until you release it`));

  const released = await h.call(lead, "lead", "release", { task: "L1-T2" });
  assert.equal(released.ok, true, released.text);
  assert.ok(h.agents.get(side.peer!)!.archivedAt);
  assert.equal(existsSync(side.worktree!), false, "its copy is put away with it");
  assert.equal(h.git(h.root, "branch", "--list", side.branch!).trim(), "", "and so is its branch, merged into the lane");
});

test("a merged parallel task's copy goes once its kept Peer is gone, whether the Human archived it or the lane closed", async () => {
  const { h, lane } = await laneWithPeer();
  const side = await mergedBeside(h, lane.lead!);
  const seat = h.agents.get(side.peer!)!;
  seat.archivedAt = new Date().toISOString();
  await h.tick();
  assert.equal(existsSync(side.worktree!), false, "the round puts away a copy whose Peer is gone");

  const other = await laneWithPeer();
  const kept = await mergedBeside(other.h, other.lane.lead!);
  assert.equal((await other.h.call(other.sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" })).ok, true);
  assert.ok(other.h.agents.get(kept.peer!)!.archivedAt, "closing the lane lets its Peers go");
  assert.equal(existsSync(kept.worktree!), false);
});

test("a review of a merged parallel task reads it from the lane's copy, not from the copy its Peer keeps", async () => {
  const { h, lane } = await laneWithPeer();
  const side = await mergedBeside(h, lane.lead!);
  assert.equal((await h.call(lane.lead!, "lead", "start_review", { task: "L1-T2", focus: "Is b right?" })).ok, true);
  const reviewer = h.ledger().tasks["L1-R1"]!.peer!;
  assert.equal(h.agents.get(reviewer)!.cwd, lane.worktree);
  assert.notEqual(h.agents.get(reviewer)!.cwd, side.worktree);
});

test("landing lets a kept parallel Peer go after the turn it is in, and its merged branch goes with its copy", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const side = await mergedBeside(h, lead);
  await acceptWork(h, lead, peer, "L1-T1");
  h.agents.get(lead)!.status = "idle";
  h.agents.get(side.peer!)!.status = "running";
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(h.git(h.root, "branch", "--list", lane.branch).trim(), "", "the lane branch goes at once, being all under its landed ref");
  assert.equal(landed.ok, true, landed.text);
  assert.ok(existsSync(side.worktree!), "not taken from under a turn");
  h.agents.get(side.peer!)!.status = "idle";
  await h.endTurn(side.peer!, "done");
  assert.equal(existsSync(side.worktree!), false);
  assert.equal(h.git(h.root, "branch", "--list", side.branch!).trim(), "", "its work is in the landed lane, so its branch goes");
});
