import assert from "node:assert/strict";
import { test } from "node:test";
import { saveLedger } from "../../server/desk/ledger.ts";
import { laneWithPeer } from "./harness.ts";

const task = { key: "t", title: "More", goal: "g", acceptance: ["a"], holds: ["b.txt"], outOfScope: ["the rest"], parallel: true };

test("a lane on hold stops every seat in it at once, keeps their mail and permissions, and starts, accepts or lands nothing until it resumes", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });

  const held = await h.call(sup, "supervisor", "hold_lane", { lane: "L1", reason: "the migration would drop a table the Human needs." });
  assert.match(held.text, /^Lane L1 is on hold\. 2 of its seats were told to stop/);
  assert.match(h.agents.get(lead)!.interrupted.join("\n"), /^HOLD L1 \(Build\): the owner has stopped this lane: the migration would drop a table the Human needs\.\n\nNext: Stop where you are/);
  assert.match(h.agents.get(peer)!.interrupted.join("\n"), /^HOLD: the work on L1-T1 is stopped: the migration/);
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /On hold for 0 min: the migration would drop a table the Human needs\. resume_lane lifts it\./);

  for (const seat of [lead, peer]) h.agents.get(seat)!.status = "idle";
  const told = h.agents.get(lead)!.sent.length;
  await h.call(sup, "supervisor", "message", { to: "L1", text: "Is the table backed up?" });
  assert.equal(h.agents.get(lead)!.sent.length, told, "mail to a seat on hold waits");
  const request = { id: "req-1", kind: "tool", name: "Bash", title: "rm -rf data" };
  h.agents.get(peer)!.pending.push(request);
  await h.permission(peer, request);
  assert.deepEqual(h.agents.get(peer)!.answered.map((answer) => answer.response.behavior), ["deny"], "its permission requests are refused, not left to the Human");
  assert.match((await h.call(lead, "lead", "add_tasks", { tasks: [task] })).text, /^Lane L1 is on hold: the migration/);
  assert.match((await h.call(lead, "lead", "accept", { task: "L1-T1" })).text, /^Lane L1 is on hold/);
  assert.match((await h.call(sup, "supervisor", "land_lane", { lane: "L1" })).text, /is on hold: [^]*Resume it with resume_lane before landing it\./);
  assert.match((await h.call(sup, "supervisor", "hold_lane", { lane: "L1", reason: "again" })).text, /has been on hold since/);

  const resumed = await h.call(sup, "supervisor", "resume_lane", { lane: "L1", note: "The Human backed it up; go on." });
  assert.equal(resumed.ok, true, resumed.text);
  const toLead = h.agents.get(lead)!.sent.slice(told).join("\n");
  assert.match(toLead, /Is the table backed up\?[^]*RESUMED L1 \(Build\): the owner lifted the hold\.\n\nThe Human backed it up; go on\.\n\nNext: Carry on from where you stopped\./, "what waited reaches it with the resume");
  assert.match(h.agents.get(peer)!.sent.join("\n"), /RESUMED: the work on L1-T1 goes on\.\n\nThe Human backed it up; go on\.\n\nNext: Carry on from where you stopped\./);
  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T1" })).ok, true);
  assert.match((await h.call(sup, "supervisor", "resume_lane", { lane: "L1" })).text, /Lane L1 is not on hold\./);
});

test("a waiting lane on hold does not open when its turn comes, but once resumed; and a hold calls off a landing waiting for the Human", async () => {
  const { h, sup } = await laneWithPeer();
  await h.call(sup, "supervisor", "open_lane", { title: "Next", outcome: "x", acceptance: ["a"], outOfScope: ["the rest"], isolate: true, after: ["L1"] });
  assert.match((await h.call(sup, "supervisor", "hold_lane", { lane: "L2", reason: "wait for the Human" })).text, /^Lane L2 is on hold\. 0 of its seats/);
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /- L2 Next: after L1 open\. On hold: wait for the Human/);
  const ledger = h.ledger();
  Object.assign(ledger.lanes.L1!, { status: "closed", landed: true });
  saveLedger(h.project.state, ledger);
  await h.runtime.desk.openWaiting(h.project);
  assert.equal(h.ledger().lanes.L2!.status, "waiting", "its turn has come, but it is on hold");
  await h.call(sup, "supervisor", "resume_lane", { lane: "L2" });
  assert.equal(h.ledger().lanes.L2!.status, "open", "resuming lets it open");

  const waiting = h.ledger();
  waiting.lanes.L2!.landApproval = { since: Date.now(), head: "abc", signals: [], evidence: [], overGate: false, ready: true };
  saveLedger(h.project.state, waiting);
  assert.match((await h.call(sup, "supervisor", "hold_lane", { lane: "L2", reason: "stop" })).text, /The landing it was waiting on is called off: land it again once it resumes\./);
  assert.equal(h.ledger().lanes.L2!.landApproval, undefined, "so nothing lands on the Human's approval while it is on hold");
});
