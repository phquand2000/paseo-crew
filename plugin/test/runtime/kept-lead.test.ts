import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { settle } from "./fake-timeline.ts";
import { harness, laneWithPeer } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

/** A lane in a copy of its own, with one commit on its branch and its Lead idle, ready to land. */
async function isolatedLane() {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Part B", outcome: "b", acceptance: ["done"], writeSet: ["b/**"], isolate: true, outOfScope: ["anything else in the repository"] });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  const lead = lane.lead!;
  h.agents.get(lead)!.status = "idle";
  mkdirSync(join(lane.worktree!, "b"), { recursive: true });
  writeFileSync(join(lane.worktree!, "b", "b.txt"), "b\n");
  h.git(lane.worktree!, "add", "-A");
  h.git(lane.worktree!, "commit", "-qm", "b");
  await h.tick();
  return { h, sup, lane, lead };
}

const archiveInPaseo = (h: Harness, id: string) => (h.paseo as unknown as { agents: { ref(id: string): { archive(): Promise<void> } } }).agents.ref(id).archive();

test("landing keeps the Lead and the copy it works in until the Supervisor releases it, and the landed branch goes with that copy", async () => {
  const { h, sup, lane, lead } = await isolatedLane();
  assert.match((await h.call(sup, "supervisor", "release", { lane: "L1" })).text, /Lane L1 is open: land_lane or drop_lane it first\. replace_lead swaps a Lead that is gone\./);
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(landed.ok, true, landed.text);
  assert.match(landed.text, new RegExp(`Lane L1 closed; squashed ${lane.branch} into one commit on main, its own commits kept at refs/seatworks/lanes/L1\\. Its Peers are archived, and its Lead ${lead} stays until you release it\\. Its working copy ${lane.slot} stays with its Lead\\.`));
  assert.equal(h.agents.get(lead)!.archivedAt, null);
  assert.ok(existsSync(lane.worktree!), "its copy stays with it");
  assert.notEqual(h.git(h.root, "branch", "--list", lane.branch).trim(), "", "and so does its landed branch, checked out there");
  assert.match(h.heard(lead).join("\n"), /LANE CLOSED L1 \(Part B\): landed[^]*you stay on with what you know of it until the owner releases you/);
  assert.match((await h.call(lead, "lead", "status", {})).text, /^Lane L1 \(Part B\) is closed and landed\. You are kept on with what you know of it until the owner releases you: nothing of it is yours to do\.$/);
  assert.match((await h.call(sup, "supervisor", "status", {})).text, new RegExp(`## Kept Leads\\n\\n- L1 Part B, landed: Lead ${lead} idle \\d+ min, in ${lane.slot}\\. release lane L1 once its work is done or the Human asks\\.`));

  const released = await h.call(sup, "supervisor", "release", { lane: "L1" });
  assert.equal(released.text, `Lane L1's Lead ${lead} is released, and its working copy ${lane.slot} is put away.`);
  assert.ok(h.agents.get(lead)!.archivedAt);
  assert.equal(existsSync(lane.worktree!), false);
  assert.equal(h.git(h.root, "branch", "--list", lane.branch).trim(), "", "the landed branch goes with its copy");
  assert.match((await h.call(sup, "supervisor", "release", { lane: "L1" })).text, /Lane L1's Lead is gone already, and nothing of it is kept\./);
});

test("a kept Lead released mid-turn keeps its copy until that turn ends, and a dropped lane keeps its branch", async () => {
  const { h, sup, lane, lead } = await isolatedLane();
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "the outcome was wrong" })).ok, true);
  h.agents.get(lead)!.status = "running";
  writeFileSync(join(lane.worktree!, "half-written.txt"), "not committed yet\n");
  assert.match((await h.call(sup, "supervisor", "release", { lane: "L1" })).text, new RegExp(`its working copy ${lane.slot} is put away once ${lead} finish the turn they are in\\.`));
  assert.ok(h.ledger().slots[lane.slot!], "and until then the copy is still the lane's, so nothing else is sent into it");
  assert.equal(existsSync(join(lane.worktree!, "half-written.txt")), true, "removing the copy --force would take what the Lead has not committed");

  h.agents.get(lead)!.status = "idle";
  await h.endTurn(lead, "stopping");
  assert.equal(existsSync(lane.worktree!), false, "once the Lead stops, the copy is put away");
  assert.equal(existsSync(dirname(lane.worktree!)), false, "and the folder the desk made for this project's copies goes with the last of them");
  assert.deepEqual(Object.keys(h.ledger().slots), []);
  assert.notEqual(h.git(h.root, "branch", "--list", lane.branch).trim(), "", "a lane dropped without landing keeps its branch for the Human");
});

test("a lane in the Human's own copy puts that copy back on base at close, once the kept Lead ends the turn it is in", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  h.commit(lane.worktree!, "a.txt", "one\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "one" });
  await h.idle(peer);
  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T1" })).ok, true);
  h.agents.get(lead)!.status = "running";
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.match(landed.text, new RegExp(`The project's own copy goes back to main once ${lead} finish the turn they are in\\.`));
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), lane.branch, "not switched under the Lead's turn");
  assert.ok(h.agents.get(peer)!.archivedAt, "its Peers go with the lane");

  h.agents.get(lead)!.status = "idle";
  await h.endTurn(lead, "Reported.");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
  assert.equal(h.agents.get(lead)!.archivedAt, null, "the Lead itself stays");
  assert.match((await h.call(sup, "supervisor", "release", { lane: "L1" })).text, new RegExp(`^Lane L1's Lead ${lead} is released\\.$`), "and holds no copy of its own to put away");
});

test("a kept Lead archived in Paseo, here with its Supervisor, leaves its copy to the round, which puts it away", async () => {
  const { h, sup, lane, lead } = await isolatedLane();
  assert.equal((await h.call(sup, "supervisor", "land_lane", { lane: "L1" })).ok, true);
  assert.ok(existsSync(lane.worktree!), "kept with its Lead");
  await archiveInPaseo(h, sup);
  assert.ok(h.agents.get(lead)!.archivedAt, "Paseo archives a Supervisor's Leads with it");
  await h.tick();
  assert.equal(existsSync(lane.worktree!), false);
  assert.equal(h.git(h.root, "branch", "--list", lane.branch).trim(), "");
});

test("the Human writing to a kept Lead reaches the Supervisor, and the Supervisor can write to it too", async () => {
  const { h, sup, lead } = await isolatedLane();
  assert.equal((await h.call(sup, "supervisor", "land_lane", { lane: "L1" })).ok, true);
  h.timelineOf(lead).add({ type: "user_message", text: "Why squash?", clientMessageId: "app-1" });
  await settle();
  await h.idle(sup);
  assert.match(h.heard(sup).join("\n"), /HUMAN WROTE to the Lead kept from L1 \(Part B\) directly, past you:\n<human>\nWhy squash\?\n<\/human>\n\nNext: Lane L1 is closed: if it asks for more work, open a lane for it; if it settles the concept, write it into CONTEXT\.md\./);

  const sent = await h.call(sup, "supervisor", "message", { to: "L1", text: "What would you change next time?" });
  assert.equal(sent.ok, true, sent.text);
  await h.idle(lead);
  assert.match(h.heard(lead).join("\n"), /What would you change next time\?/);
});

test("closing a lane settles the asks still open in it, so its kept Lead is never reminded of them", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  assert.equal((await h.call(peer, "peer", "ask", { question: "Round half up?", bestGuess: "half up" })).ok, true);
  const ask = Object.values(h.ledger().asks)[0]!;
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" })).ok, true);
  assert.deepEqual([h.ledger().asks[ask.id]!.status, h.ledger().asks[ask.id]!.answer], ["answered", "Lane L1 closed before this was answered."]);
  await h.idle(lane.lead!);
  const before = h.heard(lane.lead!).length;
  await h.tick(Date.now() + 60 * 60_000);
  assert.equal(h.heard(lane.lead!).length, before, "no reminder about a lane that is closed");
});

test("a kept Lead Paseo could not read at close keeps its copy: one failed look is not a Lead gone", async () => {
  const { h, sup, lane, lead } = await isolatedLane();
  const seats = (h.paseo as unknown as { agents: { ref(id: string): { refresh(): Promise<unknown> } } }).agents;
  const ref = seats.ref;
  let failed = false;
  seats.ref = (id) => {
    const handle = ref(id);
    if (id !== lead || failed || h.ledger().lanes.L1!.status !== "closed") return handle;
    failed = true;
    return Object.assign(Object.create(handle), { refresh: () => Promise.reject(new Error("the daemon is busy")) });
  };
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(landed.ok, true, landed.text);
  assert.equal(failed, true, "the close read its Lead while Paseo could not answer");
  assert.equal(h.agents.get(lead)!.archivedAt, null);
  assert.ok(existsSync(lane.worktree!), "its copy stays with it; the round puts it away if the Lead really is gone");
});
