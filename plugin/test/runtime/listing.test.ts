import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer, listedRound, nobodySeated } from "./harness.ts";

test("a round reads Paseo's listing: it looks again before calling a seat gone, moves nothing without one, and reads an empty one as a machine nobody sits at", async (t) => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const beside = (key: string, title: string, held: string) => ({
    tasks: [{ key, title, goal: "g", acceptance: ["a"], holds: [held], outOfScope: ["the rest"], parallel: true }],
  });
  const { round, release } = await listedRound(h);
  assert.equal((await h.call(lead, "lead", "add_tasks", beside("u", "Second", "b.txt"))).ok, true);
  const rounding = {
    title: "Rounding",
    outcome: "money rounds correctly",
    acceptance: ["a"],
    outOfScope: ["the rest"],
  };
  assert.equal((await h.call(sup, "supervisor", "open_lane", { ...rounding, isolate: true })).ok, true);
  const other = h.ledger().lanes.L2!;
  assert.equal((await h.call(other.lead!, "lead", "add_tasks", beside("v", "Third", "c.txt"))).ok, true);
  const third = h.ledger().tasks["L2-T1"]!;
  assert.equal(
    (await h.call(third.peer!, "peer", "ask", { question: "Which rounding?", bestGuess: "half up" })).ok,
    true,
  );
  release();
  await round;
  const second = h.ledger().tasks["L1-T2"]!;
  assert.deepEqual([second.status, second.peerGone ?? false], ["running", false]);
  assert.deepEqual(
    Object.values(h.ledger().asks).map((ask) => ask.to),
    [other.lead],
  );
  await h.idle(lead);
  await h.idle(sup);
  assert.doesNotMatch(h.heard(lead).join("\n"), /was closed or archived/);
  assert.doesNotMatch(h.heard(sup).join("\n"), /LEAD GONE/);

  h.agents.get(lead)!.status = "running";
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" })).ok, true);
  const writers = () => h.ledger().lanes.L1!.restoring?.writers.sort();
  assert.deepEqual(writers(), [lead, peer].sort());
  const home = [...h.workspaceNames].find(([, name]) => name === h.project.slug)![0];
  const branch = h.git(h.root, "branch", "--show-current").trim();
  const agents = h.paseo as { agents: { list: () => Promise<unknown> } };
  const down = t.mock.method(agents.agents, "list", () =>
    Promise.reject(new Error("Transport not connected (status: disconnected)")),
  );
  await assert.rejects(h.tick(), /Transport not connected/);
  down.mock.restore();
  assert.deepEqual(writers(), [lead, peer].sort());
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), branch);
  assert.equal(h.archivedWorkspaces.has(home), false);

  nobodySeated(h);
  await h.tick();
  assert.equal(h.ledger().lanes.L1!.restoring, undefined);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
  assert.deepEqual([h.ledger().tasks["L2-T1"]!.status, h.ledger().tasks["L2-T1"]!.peerGone], ["stalled", true]);
});
