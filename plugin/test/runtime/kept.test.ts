import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type harness, laneWithPeer } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

const task = (key: string, title: string, path = "a.txt", extra: Record<string, unknown> = {}) => ({
  key,
  title,
  goal: "g",
  acceptance: ["a"],
  ...(extra.parallel ? { holds: [path] } : { hints: [path] }),
  outOfScope: ["the rest of the repository"],
  ...extra,
});

/** The Peer commits `text` to `file` in the lane's copy and hands its task back, and the Lead accepts it and it merges. */
async function acceptWork(h: Harness, lead: string, peer: string, id: string, file = "a.txt", text = `${id}\n`) {
  h.commit(h.ledger().lanes.L1!.worktree!, file, text);
  const done = await h.call(peer, "peer", "done", { outcome: "complete", summary: text.trim() });
  assert.equal(done.ok, true, done.text);
  await h.idle(peer);
  const accepted = await h.call(lead, "lead", "accept", { task: id });
  assert.equal(accepted.ok, true, accepted.text);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks[id]!.status, "merged");
  return accepted.text;
}

const live = (h: Harness) =>
  [...h.agents.values()]
    .filter((agent) => agent.provider.startsWith("sw2-peer-") && !agent.archivedAt)
    .map((agent) => agent.id);

const kept = (id: string, seat: string) =>
  new RegExp(
    `- ${id} [^:]+: merged, hand-back \\d+ min ago; its Peer ${seat} idle \\d+ min is kept until you release it`,
  );

test("a Peer whose task is accepted is kept for rework until its Lead releases it, and the lane's copy never has two writers", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const say = async (tool: string, args: Record<string, unknown>) => (await h.call(lead, "lead", tool, args)).text;
  const status = () => say("status", {});
  assert.match(
    await say("release", { task: "L1-T1" }),
    /L1-T1 is running: accept it first, or cut it, which stops its Peer\./,
  );

  await h.call(lead, "lead", "add_tasks", { tasks: [task("u", "Second", "a.txt", { after: ["L1-T1"] })] });
  assert.match(await acceptWork(h, lead, peer, "L1-T1"), /^L1-T1 is in the merge queue\./);
  const second = h.ledger().tasks["L1-T2"]!;
  assert.equal(second.status, "running");
  assert.notEqual(second.peer, peer, "a task never goes to a Peer that worked another");
  assert.deepEqual(live(h), [peer, second.peer], "and the Peer kept is not let go for it");
  assert.match(
    h.heard(lead).join("\n"),
    new RegExp(`Started L1-T2 in the lane's working copy on ${second.branch} with Peer ${second.peer}\\.`),
  );
  assert.match(
    await status(),
    new RegExp(
      `- L1-T1 Clean build: merged, hand-back \\d+ min ago; its Peer ${peer} idle \\d+ min is kept until you release it`,
    ),
  );
  const message = await h.call(lead, "lead", "message", { to: "L1-T1", text: "why a.txt?" });
  assert.equal(message.ok, false);
  assert.match(
    message.text,
    /^L1-T1 is merged, and its Peer is kept only to take rework: send rework if its work must change\./,
    "not with the Peer said to be gone",
  );
  assert.match(await say("rework", { task: "L1-T1", text: "x" }), /L1-T2 holds the lane's working copy/);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged", "and nothing moved");

  await acceptWork(h, lead, second.peer!, "L1-T2");
  assert.deepEqual(live(h), [peer, second.peer], "one kept for each accepted task");
  const both = await status();
  assert.match(both, kept("L1-T1", peer));
  assert.match(both, kept("L1-T2", second.peer!));
  await h.call(lead, "lead", "start_review", { task: "L1-T2", focus: "Is it right?" });
  assert.match(await say("release", { task: "L1-R1" }), /^L1-R1 is a review: its reviewer goes when you cut it\./);
  await h.call(lead, "lead", "cut", { task: "L1-R1", reason: "read it" });

  const ready = await h.call(lead, "lead", "report", { summary: "the lane is done", ready: true });
  assert.equal(ready.ok, true, ready.text);
  assert.ok(h.ledger().lanes.L1!.ready, "reported ready");
  const sent = await h.call(lead, "lead", "rework", {
    task: "L1-T1",
    text: "the lane review found the total off by one",
  });
  assert.equal(sent.ok, true, sent.text);
  const reopened = h.ledger().tasks["L1-T1"]!;
  assert.deepEqual(
    [reopened.status, reopened.peer, h.git(lane.worktree!, "branch", "--show-current").trim()],
    ["rework", peer, reopened.branch],
    "the same Peer, on its own branch again",
  );
  h.git(lane.worktree!, "merge-base", "--is-ancestor", lane.branch, "HEAD");
  assert.equal(h.ledger().lanes.L1!.ready, undefined, "a lane with a task open again is not ready");
  await h.idle(peer);
  assert.match(h.heard(peer).join("\n"), /REWORK requested by your lead\n\nthe lane review found the total off by one/);
  await acceptWork(h, lead, peer, "L1-T1", "a.txt", "fixed\n");

  const released = await h.call(lead, "lead", "release", { task: "L1-T1" });
  assert.equal(released.ok, true, released.text);
  assert.match(released.text, /The Peer kept from L1-T1 is released\./);
  assert.ok(h.agents.get(peer)!.archivedAt);
  assert.match(await say("release", { task: "L1-T1" }), /The Peer kept from L1-T1 is gone already\./);

  assert.match(await status(), kept("L1-T2", second.peer!));
  h.agents.get(second.peer!)!.status = "running";
  assert.equal((await h.call(lead, "lead", "release", { task: "L1-T2" })).ok, true);
  assert.equal(h.agents.get(second.peer!)!.archivedAt, null, "archived once its turn ends, not under it");
  assert.doesNotMatch(await status(), /is kept until you release it/, "though Paseo lists it until that turn ends");
  assert.match(
    await say("rework", { task: "L1-T2", text: "x" }),
    /The Peer on L1-T2 is gone: add a task for what must change\./,
  );
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");

  await h.call(lead, "lead", "add_tasks", { tasks: [task("v", "Third")] });
  const third = h.ledger().tasks["L1-T3"]!.peer!;
  await acceptWork(h, lead, third, "L1-T3");
  assert.match(await status(), kept("L1-T3", third));
  const seat = h.agents.get(third)!;
  seat.archivedAt = new Date().toISOString();
  await h.runtime.archived({ id: third, provider: seat.provider, cwd: seat.cwd, title: seat.title });
  assert.equal(h.ledger().agents[third]!.gone, true, "the Human archived it in Paseo");
  assert.doesNotMatch(await status(), /is kept until you release it/);

  await h.call(lead, "lead", "add_tasks", { tasks: [task("w", "Fourth")] });
  const fourth = h.ledger().tasks["L1-T4"]!.peer!;
  h.commit(lane.worktree!, "a.txt", "fourth\n");
  await h.call(fourth, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(fourth)!.archivedAt = new Date().toISOString();
  assert.match(
    await say("rework", { task: "L1-T4", text: "x" }),
    /The Peer on L1-T4 is gone; cut the task and start a new one\./,
  );
  assert.equal(h.ledger().tasks["L1-T4"]!.status, "done", "not left waiting on a rework nobody will do");

  assert.equal((await h.call(lead, "lead", "cut", { task: "L1-T4", reason: "wrong" })).ok, true);
  await h.call(lead, "lead", "add_tasks", { tasks: [task("x", "Again")] });
  assert.equal(h.ledger().tasks["L1-T5"]!.status, "running");
  h.commit(lane.worktree!, "a.txt", "the second task's work\n");
  const again = await h.call(lead, "lead", "cut", { task: "L1-T4", reason: "to be sure" });
  assert.equal(again.ok, false);
  assert.match(again.text, /^L1-T4 is already cut\.$/);
  assert.equal(
    readFileSync(join(lane.worktree!, "a.txt"), "utf-8"),
    "the second task's work\n",
    "the lane's copy is not reset under the task writing in it now",
  );
});

/** A task beside L1-T1, with `text` committed to `file` in its own copy, handed back, accepted and merged. */
async function mergedBeside(h: Harness, lead: string, title: string, file: string, text = `${file}\n`) {
  await h.call(lead, "lead", "add_tasks", { tasks: [task("p", title, file, { parallel: true })] });
  const side = Object.values(h.ledger().tasks).find((entry) => entry.title === title)!;
  h.commit(side.worktree!, file, text);
  assert.equal((await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: file })).ok, true);
  await h.idle(side.peer!);
  assert.equal((await h.call(lead, "lead", "accept", { task: side.id })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks[side.id]!.status, "merged");
  return h.ledger().tasks[side.id]!;
}

test("a task beside others keeps its Peer in its own copy once merged, until its Lead releases it, the Human archives it, or the lane lands", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const side = await mergedBeside(h, lead, "Beside", "b.txt", "B\n");
  assert.equal(h.agents.get(side.peer!)!.archivedAt, null, "the merge does not let it go: its Lead does");
  assert.ok(existsSync(side.worktree!), "and it keeps the copy it works in");
  assert.match(
    (await h.call(lead, "lead", "status", {})).text,
    new RegExp(`- L1-T2 Beside: merged[^\\n]*; its Peer ${side.peer} idle \\d+ min is kept until you release it`),
  );

  const quotes = await mergedBeside(h, lead, "Quotes", "d.txt");
  assert.equal((await h.call(lead, "lead", "rework", { task: "L1-T2", text: "b wants its second line" })).ok, true);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "rework");
  assert.equal(
    h.git(side.worktree!, "show", "HEAD:d.txt"),
    "d.txt\n",
    "sent back after its merge, it takes up the lane as it stands before it reads the letter",
  );
  h.commit(side.worktree!, "b.txt", "B\nB2\n");
  assert.equal((await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "b2" })).ok, true);
  await h.idle(side.peer!);
  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(h.git(lane.worktree!, "show", `${lane.branch}:b.txt`), "B\nB2\n", "the fix is in the lane");

  const released = await h.call(lead, "lead", "release", { task: "L1-T2" });
  assert.equal(released.ok, true, released.text);
  assert.ok(h.agents.get(side.peer!)!.archivedAt);
  assert.equal(existsSync(side.worktree!), false, "its copy is put away with it");
  assert.equal(h.git(h.root, "branch", "--list", side.branch!).trim(), "", "and its branch, merged into the lane");

  h.agents.get(quotes.peer!)!.archivedAt = new Date().toISOString();
  await h.tick();
  assert.equal(existsSync(quotes.worktree!), false, "the round puts away a copy whose Peer the Human archived");

  const last = await mergedBeside(h, lead, "Tail", "e.txt");
  await acceptWork(h, lead, peer, "L1-T1");
  h.agents.get(lead)!.status = "idle";
  h.agents.get(last.peer!)!.status = "running";
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(h.git(h.root, "branch", "--list", lane.branch).trim(), "", "the lane branch goes at once");
  assert.equal(landed.ok, true, landed.text);
  assert.ok(existsSync(last.worktree!), "a kept Peer's copy is not taken from under its turn");
  h.agents.get(last.peer!)!.status = "idle";
  await h.endTurn(last.peer!, "done");
  assert.equal(existsSync(last.worktree!), false);
  assert.equal(h.git(h.root, "branch", "--list", last.branch!).trim(), "", "its work is in the landed lane");
});
