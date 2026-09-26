import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { DeskServices } from "../../server/desk/services.ts";
import { harness, laneWithPeer } from "./harness.ts";

test("a ready report waits for the merges its Lead accepted before it, and gates the lane with them in", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", {
    title: "Beside only",
    outcome: "c",
    acceptance: ["c"],
    outOfScope: ["the rest"],
  });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", {
    tasks: [
      {
        key: "s",
        title: "Side",
        goal: "g",
        acceptance: ["c"],
        holds: ["c.txt"],
        outOfScope: ["the rest"],
        parallel: true,
      },
    ],
  });
  const side = h.ledger().tasks["L1-T1"]!;
  h.commit(side.worktree!, "c.txt", "C\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  h.agents.get(side.peer!)!.status = "idle";
  await h.call(sup, "supervisor", "set_project", { gate: "test -f c.txt", gateOn: "lane" });
  // Work left in the lane's copy, on the lane branch, holds the merge back until it is clean.
  writeFileSync(join(lane.worktree!, "a.txt"), "being written\n");
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "queued");
  h.git(lane.worktree!, "checkout", "--", "a.txt");

  assert.equal((await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true })).ok, true);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.match(h.heard(sup).join("\n"), /test -f c\.txt passed on the lane branch/);
});

test("a ready report is refused while a seat is mid-turn in the lane's copy, and taken once that turn ends", async () => {
  const { h, lane, peer } = await laneWithPeer();
  h.agents.get(peer)!.status = "running";
  const refused = await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  assert.equal(refused.ok, false);
  assert.match(
    refused.text,
    new RegExp(
      `^${peer} is mid-turn in the lane's working copy, so what ready claims could still change under the gate\\. Report ready once that turn ends\\.$`,
    ),
  );
  assert.equal(h.ledger().lanes.L1!.ready, undefined);
  assert.equal(
    (await h.call(lane.lead!, "lead", "report", { summary: "not yet", ready: false })).ok,
    true,
    "a report that claims nothing is not held back",
  );
  await h.idle(peer);
  // Its turn over, its task still has the copy on its own branch: the lane branch there is not what ready would claim.
  assert.match(
    (await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true })).text,
    new RegExp(
      `^The lane's working copy is on ${h.ledger().tasks["L1-T1"]!.branch}, L1-T1's branch, not ${lane.branch}: the gate would read L1-T1's tree\\. Report ready once it is merged or cut\\.$`,
    ),
  );
  assert.equal((await h.call(peer, "peer", "done", { outcome: "complete", summary: "nothing to change" })).ok, true);
  await h.idle(peer);
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal((await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true })).ok, true);
  assert.ok(h.ledger().lanes.L1!.ready);
});

test("a seat in the lane's copy the desk cannot look at counts as mid-turn: it may be writing", async (t) => {
  const { h, lane, peer } = await laneWithPeer();
  await h.idle(peer);
  const { roster } = (h.runtime.desk as unknown as { services: DeskServices }).services;
  const look = roster.look.bind(roster);
  t.mock.method(roster, "look", (id: string) =>
    id === peer ? Promise.reject(new Error("the daemon did not answer")) : look(id),
  );
  const refused = await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  assert.match(refused.text, new RegExp(`^${peer} is mid-turn in the lane's working copy`));
});

test("a lane's READY goes when it takes on new tasks, and when a task merges into it after the report", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", {
    title: "Beside only",
    outcome: "c",
    acceptance: ["c"],
    outOfScope: ["the rest"],
  });
  const lead = h.ledger().lanes.L1!.lead!;
  assert.equal((await h.call(lead, "lead", "report", { summary: "nothing to do yet", ready: true })).ok, true);
  await h.call(lead, "lead", "add_tasks", {
    tasks: [
      {
        key: "s",
        title: "Side",
        goal: "g",
        acceptance: ["c"],
        holds: ["c.txt"],
        outOfScope: ["the rest"],
        parallel: true,
      },
    ],
  });
  assert.equal(h.ledger().lanes.L1!.ready, undefined, "what it reported ready is not what it will hold");
  assert.equal((await h.call(lead, "lead", "report", { summary: "the rest waits on L1-T1", ready: true })).ok, true);
  const side = h.ledger().tasks["L1-T1"]!;
  h.commit(side.worktree!, "c.txt", "C\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  h.agents.get(side.peer!)!.status = "idle";
  await h.call(lead, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.equal(h.ledger().lanes.L1!.ready, undefined, "its branch moved after the report");
});
