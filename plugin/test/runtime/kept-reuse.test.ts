import assert from "node:assert/strict";
import { test } from "node:test";
import { type harness, laneWithPeer } from "./harness.ts";
import { heldGit, heldLook } from "./lane-gates.ts";
import { book, hookAgent, notice } from "./noticed.ts";

type Harness = ReturnType<typeof harness>;

const task = (key: string, title: string, extra: Record<string, unknown> = {}) => ({
  key,
  title,
  goal: "g",
  acceptance: ["a"],
  hints: ["a.txt"],
  outOfScope: ["the rest of the repository"],
  ...extra,
});

/** The Peer commits its work and hands `id` back, and the Lead accepts it and it merges. */
async function merged(h: Harness, lead: string, peer: string, id: string) {
  h.commit(h.ledger().lanes.L1!.worktree!, "a.txt", `${id}\n`);
  assert.equal((await h.call(peer, "peer", "done", { outcome: "complete", summary: id })).ok, true);
  await h.idle(peer);
  assert.equal((await h.call(lead, "lead", "accept", { task: id })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks[id]!.status, "merged");
}

const second = (h: Harness, lead: string) =>
  h.call(lead, "lead", "add_tasks", { tasks: [task("u", "Second", { peer: "L1-T1" })] });

test("a kept Peer given a task mid-turn takes it when that turn ends, and the watch, its letters and its record follow it there", async () => {
  const { h, lane, peer } = await laneWithPeer({ attention: { watch: true } });
  const lead = lane.lead!;
  await notice(h, peer, "loop", "attend", "the same test run four times");
  assert.deepEqual([book(h).I1!.task, book(h).I1!.open, book(h).I1!.told !== undefined], ["L1-T1", true, true]);
  await merged(h, lead, peer, "L1-T1");

  await h.beginTurn(peer);
  h.agents.get(peer)!.status = "running";
  await second(h, lead);
  const held = h.ledger().tasks["L1-T2"]!;
  assert.deepEqual([held.status, held.peer, held.held?.tried], ["waiting", undefined, undefined]);
  assert.match(held.held!.why, /The Peer kept from L1-T1 is in a turn; L1-T2 starts on it once that turn ends\./);
  const moved = await h.call(lead, "lead", "amend_task", { task: "L1-T2", why: "x", parallel: true, holds: ["b.txt"] });
  assert.match(moved.text, /L1-T2 starts on the Peer kept from L1-T1, which works in the lane's copy; name a role/);

  h.agents.get(peer)!.status = "idle";
  await h.endTurn(peer, "noted");
  const started = h.ledger().tasks["L1-T2"]!;
  assert.deepEqual([started.status, started.peer], ["running", peer], "its turn's end starts it, no round needed");
  assert.equal(h.ledger().tasks["L1-T2"]!.silent, 0, "the turn it was in is not the new task's silence");
  assert.equal(book(h).I1!.open, false, "what the watch saw on L1-T1 is closed as the Peer leaves it");

  const again = await notice(h, peer, "loop", "attend", "the same test run five times");
  assert.deepEqual(again.sent, ["I2"], "a new finding on L1-T2 is told, not folded into L1-T1's");
  assert.equal(book(h).I2!.task, "L1-T2");

  await h.runtime.turnEnded({
    agent: hookAgent(h, peer),
    turnId: "t-failed",
    outcome: { kind: "failed", error: { message: "the model is overloaded" } },
    timeline: [],
  });
  assert.match(h.heard(lead).join("\n"), /L1-T2 · [^\n]* · Second[^\n]*\n?[^]*the model is overloaded/);

  const record = await h.call(lead, "lead", "record", { of: "L1-T1" });
  assert.match(record.text, /^L1-T1 Clean build's Peer works L1-T2 now: record L1-T2 for its steps\./);
  assert.match(record.text, /L1-T1 is merged\./);
});

test("a kept Peer whose turn begins as its next task starts reads that brief before it can hand the task back", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  await merged(h, lead, peer, "L1-T1");
  const gate = heldGit("switch");
  const adding = second(h, lead);
  await gate.reached;
  h.agents.get(peer)!.status = "running";
  gate.release();
  await adding;
  assert.equal(h.ledger().tasks["L1-T2"]!.peer, peer);
  const args = { outcome: "complete", summary: "nothing yet" };
  const request = { id: "p1", agent: peer, role: "peer", tool: "done", args, cwd: h.root, at: Date.now() };
  const done = await h.runtime.answer(request, new AbortController().signal);
  assert.equal(done.ok, false);
  assert.match(done.text, /mail that changes your work came for you, below[^]*TASK L1-T2: Second/);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "running");
});

test("a kept Peer let go while its next task starts leaves that task to a new Peer, and one that took its next task cannot be let go under it", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  await merged(h, lead, peer, "L1-T1");
  const gate = heldGit("switch");
  const adding = second(h, lead);
  await gate.reached;
  assert.equal((await h.call(sup, "supervisor", "release", { task: "L1-T1" })).ok, true);
  gate.release();
  await adding;
  const waiting = h.ledger().tasks["L1-T2"]!;
  assert.deepEqual([waiting.status, waiting.held?.tried], ["waiting", undefined], "not left for an unrelated merge");
  await h.tick();
  const moved = h.ledger().tasks["L1-T2"]!;
  assert.equal(moved.status, "running");
  assert.notEqual(moved.peer, peer, "never bound to the Peer let go");
  assert.match(h.heard(lead).join("\n"), /The Peer kept from L1-T1 could not take it, so a new one did\./);

  await merged(h, lead, moved.peer!, "L1-T2");
  const looked = heldLook(h, moved.peer!);
  const releasing = h.call(sup, "supervisor", "release", { task: "L1-T2" });
  await looked.reached;
  await h.call(lead, "lead", "add_tasks", { tasks: [task("v", "Third", { peer: "L1-T2" })] });
  assert.equal(h.ledger().tasks["L1-T3"]!.peer, moved.peer);
  looked.release();
  const released = await releasing;
  assert.equal(released.ok, false);
  assert.match(released.text, /The Peer kept from L1-T2 took L1-T3 since/);
  assert.equal(h.agents.get(moved.peer!)!.archivedAt, null);
  assert.equal(h.ledger().agents[moved.peer!]!.gone, undefined);
});
