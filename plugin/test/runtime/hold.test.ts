import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a lane on hold stops its seats, keeps their mail, refuses every move, and resumes with what waited", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const hold = (id: string, reason: string) => h.call(sup, "supervisor", "hold_lane", { lane: id, reason });
  await h.call(sup, "supervisor", "open_lane", {
    title: "Next",
    outcome: "x",
    acceptance: ["a"],
    outOfScope: ["the rest"],
    isolate: true,
    after: ["L1"],
  });
  assert.match((await hold("L2", "wait for the Human")).text, /^Lane L2 is on hold\. 0 of its seats/);
  assert.match(
    (await h.call(sup, "supervisor", "status", {})).text,
    /- L2 Next: after L1 open\. On hold: wait for the Human/,
  );

  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  const reason = "the migration would drop a table the Human needs.";
  assert.match((await hold("L1", reason)).text, /^Lane L1 is on hold\. 2 of its seats were told to stop/);
  assert.match(
    h.agents.get(lead)!.interrupted.join("\n"),
    /^HOLD L1 \(Build\): the owner has stopped this lane: the migration would drop a table the Human needs\.\n\nNext: Stop where you are/,
  );
  assert.match(h.agents.get(peer)!.interrupted.join("\n"), /^HOLD: the work on L1-T1 is stopped: the migration/);
  assert.match(
    (await h.call(sup, "supervisor", "status", {})).text,
    /On hold for 0 min: the migration would drop a table the Human needs\. resume_lane lifts it\./,
  );

  for (const seat of [lead, peer]) h.agents.get(seat)!.status = "idle";
  const told = h.agents.get(lead)!.sent.length;
  await h.call(sup, "supervisor", "message", { to: "L1", text: "Is the table backed up?" });
  assert.equal(h.agents.get(lead)!.sent.length, told);
  const request = { id: "req-1", kind: "tool", name: "Bash", title: "rm -rf data" };
  h.agents.get(peer)!.pending.push(request);
  await h.permission(peer, request);
  assert.deepEqual(
    h.agents.get(peer)!.answered.map((answer) => answer.response.behavior),
    ["deny"],
  );
  const refused =
    /^Lane L1 is on hold: the migration[^]*Nothing is accepted, started or landed in it until it resumes\./;
  const tasks = [
    {
      key: "t",
      title: "More",
      goal: "g",
      acceptance: ["a"],
      holds: ["b.txt"],
      outOfScope: ["the rest"],
      parallel: true,
    },
  ];
  for (const [tool, args] of [
    ["add_tasks", { tasks }],
    ["accept", { task: "L1-T1" }],
    ["start_review", { task: "L1-T1", focus: "the cart" }],
    ["rework", { task: "L1-T1", text: "once more" }],
    ["report", { summary: "done", ready: true }],
  ] as const)
    assert.match((await h.call(lead, "lead", tool, args)).text, refused, tool);
  assert.match(
    (await h.call(sup, "supervisor", "land_lane", { lane: "L1" })).text,
    /is on hold: [^]*Resume it with resume_lane before landing it\./,
  );
  assert.match((await hold("L1", "again")).text, /has been on hold since/);
  assert.equal(
    (await h.call(lead, "lead", "report", { summary: "stopped where HOLD found me", ready: false })).ok,
    true,
  );
  assert.deepEqual(
    Object.values(h.ledger().tasks).map((task) => [task.id, task.status]),
    [["L1-T1", "done"]],
  );

  const resumed = await h.call(sup, "supervisor", "resume_lane", {
    lane: "L1",
    note: "The Human backed it up; go on.",
  });
  assert.equal(resumed.ok, true, resumed.text);
  assert.match(
    h.agents.get(lead)!.sent.slice(told).join("\n"),
    /Is the table backed up\?[^]*RESUMED L1 \(Build\): the owner lifted the hold\.\n\nThe Human backed it up; go on\.\n\nNext: Carry on from where you stopped\./,
  );
  assert.match(
    h.agents.get(peer)!.sent.join("\n"),
    /RESUMED: the work on L1-T1 goes on\.\n\nThe Human backed it up; go on\.\n\nNext: Carry on from where you stopped\./,
  );
  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T1" })).ok, true);
  assert.match((await h.call(sup, "supervisor", "resume_lane", { lane: "L1" })).text, /Lane L1 is not on hold\./);

  await h.runtime.desk.settled(h.project);
  assert.equal((await h.call(sup, "supervisor", "land_lane", { lane: "L1" })).ok, true);
  assert.equal(h.ledger().lanes.L2!.status, "waiting");
  await h.call(sup, "supervisor", "resume_lane", { lane: "L2" });
  const next = h.ledger().lanes.L2!;
  assert.equal(next.status, "open");
  await hold("L2", "wait for the Human");
  Object.assign(h.agents.get(next.lead!)!, { archivedAt: new Date().toISOString(), status: "closed" });
  assert.match(
    (await h.call(sup, "supervisor", "replace_lead", { lane: "L2" })).text,
    /^Lane L2 is on hold: wait for the Human\. Nothing is accepted, started or landed in it until it resumes\./,
  );
});
