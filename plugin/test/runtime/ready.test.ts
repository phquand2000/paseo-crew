import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { DeskServices } from "../../server/desk/services.ts";
import { laneWithPeer } from "./harness.ts";

test("a ready report waits for the merges its Lead accepted before it, and gates the lane with them in", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  await h.call(sup, "supervisor", "set_project", { gate: "test -f c.txt" });
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "s", title: "Side", goal: "g", acceptance: ["c"], holds: ["c.txt"], outOfScope: ["the rest"], parallel: true }] });
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "C\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  // Work left in the lane's copy holds the merge back until a turn ends there.
  writeFileSync(join(lane.worktree!, "scratch.txt"), "x\n");
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "queued");
  rmSync(join(lane.worktree!, "scratch.txt"));
  await h.idle(peer);

  assert.equal((await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true })).ok, true);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.match(h.heard(sup).join("\n"), /test -f c\.txt passed on the lane branch/);
});

test("a ready report is refused while a seat is mid-turn in the lane's copy, and taken once that turn ends", async () => {
  const { h, lane, peer } = await laneWithPeer();
  h.agents.get(peer)!.status = "running";
  const refused = await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  assert.equal(refused.ok, false);
  assert.match(refused.text, new RegExp(`^${peer} is mid-turn in the lane's working copy, so what ready claims could still change under the gate\\. Report ready once that turn ends\\.$`));
  assert.equal(h.ledger().lanes.L1!.ready, undefined);
  assert.equal((await h.call(lane.lead!, "lead", "report", { summary: "not yet", ready: false })).ok, true, "a report that claims nothing is not held back");
  await h.idle(peer);
  assert.equal((await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true })).ok, true);
  assert.ok(h.ledger().lanes.L1!.ready);
});

test("a seat in the lane's copy the desk cannot look at counts as mid-turn: it may be writing", async (t) => {
  const { h, lane, peer } = await laneWithPeer();
  await h.idle(peer);
  const { roster } = (h.runtime.desk as unknown as { services: DeskServices }).services;
  const look = roster.look.bind(roster);
  t.mock.method(roster, "look", (id: string) => (id === peer ? Promise.reject(new Error("the daemon did not answer")) : look(id)));
  const refused = await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  assert.match(refused.text, new RegExp(`^${peer} is mid-turn in the lane's working copy`));
});
