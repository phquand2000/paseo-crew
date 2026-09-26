import assert from "node:assert/strict";
import { test } from "node:test";
import { sentBy } from "../../server/core/sent-by.ts";
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

const peers = (h: Harness) => [...h.agents.values()].filter((agent) => agent.provider.startsWith("sw2-peer-"));

test("a Peer whose task is accepted stays in the lane's copy, takes the task waiting for it there by letter, and hands that task back as its own", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  assert.equal((await h.call(lead, "lead", "add_tasks", { tasks: [task("u", "Second", "a.txt", { after: ["L1-T1"] })] })).ok, true);
  assert.match(await acceptWork(h, lead, peer, "L1-T1"), /Its Peer stays in the copy with what it learned: the next task there goes to it/);
  const second = h.ledger().tasks["L1-T2"]!;
  assert.deepEqual([second.peer, second.status, peers(h).length, h.agents.get(peer)!.archivedAt], [peer, "running", 1, null], "the kept Peer takes it, and no second Peer starts");
  assert.match(h.heard(peer).at(-1)!, /^TASK L1-T2: Second$/m);
  assert.match(h.heard(peer).at(-1)!, /^Beside you: nobody now\.$/m, "a list its last brief gave does not stand");
  assert.deepEqual(sentBy({ clientMessageId: h.agents.get(peer)!.sentIds.at(-1) }), ["brief"], "its brief is the desk's, as a new Peer's first prompt is");
  assert.match(h.heard(lead).join("\n"), new RegExp(`Started L1-T2 in the lane's working copy on ${lane.branch}, with its Peer ${peer}, kept from L1-T1\\.`));

  assert.match((await h.call(lead, "lead", "record", { of: "L1-T1" })).text, /^L1-T1 Clean build's Peer, now on L1-T2 /);

  h.commit(h.ledger().lanes.L1!.worktree!, "a.txt", "two\n");
  const done = await h.call(peer, "peer", "done", { outcome: "complete", summary: "two" });
  assert.equal(done.ok, true, done.text);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "done");
});

test("a Peer handed a task and silent on it is nudged about that task", async () => {
  const { h, lane, peer } = await laneWithPeer();
  await acceptWork(h, lane.lead!, peer, "L1-T1");
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [task("u", "Second", "b.txt")] });
  h.beginTurn(peer);
  await h.endTurn(peer, "Looked around.");
  await h.idle(peer);
  assert.equal(h.ledger().tasks["L1-T2"]!.silent, 1);
  assert.match(h.heard(peer).join("\n"), /L1-T2/);
});

test("a task added fresh starts a new Peer, and the one kept in the copy is archived first, so one Peer writes there", async () => {
  const { h, lane, peer } = await laneWithPeer();
  await acceptWork(h, lane.lead!, peer, "L1-T1");
  const refused = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [task("p", "Beside", "b.txt", { parallel: true, fresh: true })] });
  assert.match(refused.text, /fresh is for a task in the lane's working copy: a parallel task always starts a Peer of its own/);

  assert.equal((await h.call(lane.lead!, "lead", "add_tasks", { tasks: [task("u", "Second", "a.txt", { fresh: true })] })).ok, true);
  const second = h.ledger().tasks["L1-T2"]!;
  assert.notEqual(second.peer, peer);
  assert.ok(h.agents.get(peer)!.archivedAt, "the kept Peer goes before the new one starts");
  assert.deepEqual(peers(h).filter((agent) => !agent.archivedAt).map((agent) => agent.id), [second.peer]);
});

test("the Lead releases the Peer kept from an accepted task; not while the task runs, and not once that Peer went on to another task", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  assert.match((await h.call(lead, "lead", "release", { task: "L1-T1" })).text, /L1-T1 is running: accept it first, or cut it, which stops its Peer\./);
  await acceptWork(h, lead, peer, "L1-T1");
  assert.match((await h.call(lead, "lead", "add_tasks", { tasks: [task("u", "Second")] })).text, new RegExp(`is L1-T2 Second: running, Peer ${peer}, kept from L1-T1`));
  assert.match((await h.call(lead, "lead", "release", { task: "L1-T1" })).text, /Its Peer went on to L1-T2; release it from there once L1-T2 is accepted\./);
  await acceptWork(h, lead, peer, "L1-T2");
  assert.match((await h.call(lead, "lead", "status", {})).text, new RegExp(`- L1-T2 Second: merged, hand-back \\d+ min ago; its Peer ${peer} idle \\d+ min is kept for the next task in the copy`));

  const released = await h.call(lead, "lead", "release", { task: "L1-T2" });
  assert.equal(released.ok, true, released.text);
  assert.match(released.text, /The Peer kept from L1-T2 is released; the next task in the lane's working copy starts a new one\./);
  assert.ok(h.agents.get(peer)!.archivedAt);
  assert.match((await h.call(lead, "lead", "release", { task: "L1-T2" })).text, /The Peer kept from L1-T2 is gone already\./);
  await h.call(lead, "lead", "add_tasks", { tasks: [task("v", "Third")] });
  assert.notEqual(h.ledger().tasks["L1-T3"]!.peer, peer);

  await h.call(lead, "lead", "add_tasks", { tasks: [task("p", "Beside", "b.txt", { parallel: true })] });
  assert.match((await h.call(lead, "lead", "release", { task: "L1-T4" })).text, /L1-T4 ran in a copy of its own, and its Peer goes with that copy once it is merged\./);
  await h.call(lead, "lead", "start_review", { task: "L1-T4", focus: "Is it right?" });
  const review = Object.values(h.ledger().tasks).find((entry) => entry.kind === "review")!;
  assert.match((await h.call(lead, "lead", "release", { task: review.id })).text, new RegExp(`${review.id} is a review: its reviewer goes when you cut it\\.`));
});

test("what the watch told about a Peer's last task does not swallow the same on its next one", async () => {
  const { h, sup, lane, peer } = await laneWithPeer({ attention: { watch: true } });
  const seat = { id: peer, provider: "sw2-peer-claude/claude-opus-5", title: peer };
  const attend = (quote: string) => [{ kind: "test-weakened", level: "attend" as const, quote, facts: ["test-weakened"] }];
  await h.runtime.desk.notice(h.project, seat, attend("L1-T1 skipped a test"));
  await acceptWork(h, lane.lead!, peer, "L1-T1");
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [task("u", "Second")] });
  await h.runtime.desk.notice(h.project, seat, attend("L1-T2 skipped a test"));
  for (const id of [sup, lane.lead!]) await h.idle(id);
  const told = [...h.heard(sup), ...h.heard(lane.lead!)].join("\n");
  assert.match(told, /L1-T1 skipped a test/);
  assert.match(told, /L1-T2 skipped a test/);
});
