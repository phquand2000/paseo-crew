import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { saveLedger } from "../../server/desk/ledger.ts";
import { tempDir } from "../tempdir.ts";
import { harness, laneWithPeer } from "./harness.ts";

const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] };
const work = (title: string, extra: Record<string, unknown> = {}) => ({ tasks: [{ key: "t", title, goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"], ...extra }] });

async function openLane() {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Build", ...scope });
  return { h, sup, lead: h.ledger().lanes.L1!.lead! };
}

/** Which of these tasks hold the lane's copy now: started in it and not yet decided. */
const writing = (h: ReturnType<typeof harness>, ids: string[]) => ids.filter((id) => h.ledger().tasks[id]?.status === "running");

test("two task calls at once in a lane's copy put one writer there, and the other waits for the copy", async () => {
  const { h, lead } = await openLane();
  const [first, second] = await Promise.all([h.call(lead, "lead", "add_tasks", work("One")), h.call(lead, "lead", "add_tasks", work("Two"))]);
  assert.deepEqual([first.ok, second.ok], [true, true], `${first.text}\n${second.text}`);
  assert.equal(writing(h, Object.keys(h.ledger().tasks)).length, 1);
  assert.match(`${first.text}\n${second.text}`, /held: L1-T\d is still writing in the lane's working copy/);
});

test("a waiting task released while another is started beside it puts one writer in the lane's copy", async () => {
  const { h, lead } = await openLane();
  await h.call(lead, "lead", "add_tasks", work("First"));
  await h.call(lead, "lead", "add_tasks", work("After", { after: ["L1-T1"] }));
  // The first is accepted without its acceptance starting what waited, so the round and a new start meet.
  const ledger = h.ledger();
  ledger.tasks["L1-T1"]!.status = "merged";
  saveLedger(h.project.state, ledger);
  const [, started] = await Promise.all([h.runtime.desk.openWaiting(h.project), h.call(lead, "lead", "add_tasks", work("Beside"))]);
  assert.equal(writing(h, ["L1-T2", "L1-T3"]).length, 1, started.text);
});

test("two lanes opened at once in the project's own copy open one there, and the other is told the copy is taken", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  // A lane open elsewhere, so each opening reads the project's files before it can decide.
  await h.call(sup, "supervisor", "open_lane", { title: "Side", ...scope, isolate: true, writeSet: ["b.txt"] });
  const [first, second] = await Promise.all([h.call(sup, "supervisor", "open_lane", { title: "Cart", ...scope }), h.call(sup, "supervisor", "open_lane", { title: "Order", ...scope })]);
  assert.deepEqual([first.ok, second.ok].sort(), [false, true]);
  assert.match((first.ok ? second : first).text, /is working in the project's own copy/);
  const inOwnCopy = Object.values(h.ledger().lanes).filter((lane) => lane.status === "open" && !lane.slot);
  assert.equal(inOwnCopy.length, 1);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), inOwnCopy[0]!.branch, "and the copy is on the branch of the lane that has it");
});

test("a waiting lane released while another is opened beside it puts one lane in the project's own copy", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Side", ...scope, isolate: true, writeSet: ["b.txt"] });
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", ...scope, isolate: true });
  await h.call(sup, "supervisor", "open_lane", { title: "Order", ...scope, after: ["L2"] });
  // The first lands without its close opening what waited, so the round and a new lane meet.
  const ledger = h.ledger();
  Object.assign(ledger.lanes.L2!, { status: "closed", landed: true });
  saveLedger(h.project.state, ledger);
  const [, pay] = await Promise.all([h.runtime.desk.openWaiting(h.project), h.call(sup, "supervisor", "open_lane", { title: "Pay", ...scope })]);
  // Whichever came second is told the copy is taken, not left to collide with the first in git.
  assert.match(pay.ok ? (h.ledger().lanes.L3!.held?.why ?? "") : pay.text, /is working in the project's own copy/);
  const inOwnCopy = Object.values(h.ledger().lanes).filter((lane) => lane.status === "open" && !lane.slot);
  assert.equal(inOwnCopy.length, 1);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), inOwnCopy[0]!.branch);
});

test("an amendment and a new task reaching for the same paths at once do not both get them", async () => {
  const { h, lead } = await openLane();
  await h.call(lead, "lead", "add_tasks", work("Beside", { holds: ["b.txt"], parallel: true }));
  const [amended, started] = await Promise.all([
    h.call(lead, "lead", "amend_task", { task: "L1-T1", why: "it needs c too", holds: ["b.txt", "c.txt"] }),
    h.call(lead, "lead", "add_tasks", work("Other", { holds: ["c.txt"], parallel: true })),
  ]);
  const said = `${amended.text}\n${started.text}`;
  const holders = Object.values(h.ledger().tasks).filter((task) => task.holds.includes("c.txt") && task.status === "running");
  assert.equal(holders.length, 1, said);
  // Whichever came second is refused or held, by the task it would have written beside.
  assert.match(said, /overlaps what L1-T\d holds at c\.txt|holds c\.txt, which L1-T1 holds and is still writing/);
});

test("two lanes amended at once to write the same path do not both get it", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", ...scope, isolate: true, writeSet: ["a.txt"] });
  await h.call(sup, "supervisor", "open_lane", { title: "Order", ...scope, isolate: true, writeSet: ["b.txt"] });
  const [first, second] = await Promise.all([
    h.call(sup, "supervisor", "amend_lane", { lane: "L1", why: "it needs c too", writeSet: ["a.txt", "c.txt"] }),
    h.call(sup, "supervisor", "amend_lane", { lane: "L2", why: "it needs c too", writeSet: ["b.txt", "c.txt"] }),
  ]);
  assert.deepEqual([first.ok, second.ok].sort(), [false, true], `${first.text}\n${second.text}`);
  assert.match((first.ok ? second : first).text, /overlaps lane L[12] at c\.txt/);
});

test("a copy two seats were writing in is put back once both turns end, however close together they end", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" })).ok, true);
  assert.deepEqual(h.ledger().lanes.L1!.restoring?.writers.sort(), [lane.lead!, peer].sort());
  for (const id of [lane.lead!, peer]) h.agents.get(id)!.status = "idle";
  await Promise.all([h.endTurn(lane.lead!, "done"), h.endTurn(peer, "done")]);
  assert.equal(h.ledger().lanes.L1!.restoring, undefined);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
});

test("a landing two seats were in the way of can go once both turns end, however close together they end", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  // main moves on, so landing starts with merging it into the lane's copy, where both are mid-turn.
  const side = join(tempDir("sw2-moved-"), "wt");
  h.git(h.root, "worktree", "add", "-q", "-b", "side", side, "main");
  h.git(side, "commit", "-qm", "moved", "--allow-empty");
  h.git(h.root, "branch", "-f", "main", "side");
  h.git(h.root, "worktree", "remove", "--force", side);
  assert.match((await h.call(sup, "supervisor", "land_lane", { lane: "L1" })).text, /a seat is mid-turn there/);
  for (const id of [lane.lead!, peer]) h.agents.get(id)!.status = "idle";
  await Promise.all([h.endTurn(lane.lead!, "done"), h.endTurn(peer, "done")]);
  await h.idle(sup);
  assert.equal(h.agents.get(sup)!.sent.join("\n").split("CAN LAND L1").length - 1, 1);
});

test("a lane closed twice at once is closed once, and the second call is told it is already being closed", async () => {
  const { h, sup } = await laneWithPeer();
  const [first, second] = await Promise.all([h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" }), h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" })]);
  assert.deepEqual([first.ok, second.ok].sort(), [false, true], `${first.text}\n${second.text}`);
  assert.match((first.ok ? second : first).text, /L1 is (already being closed|already closed)/);
});

test("a READY whose gate is still running when its lane closes is not recorded on the closed lane", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "sleep 1" });
  await h.call(sup, "supervisor", "open_lane", { title: "Slow", ...scope });
  const lead = h.ledger().lanes.L1!.lead!;
  const reporting = h.call(lead, "lead", "report", { summary: "ready to land", ready: true });
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" })).ok, true);
  const reported = await reporting;
  assert.equal(reported.ok, false, reported.text);
  assert.equal(h.ledger().lanes.L1!.ready, undefined);
});

test("an ask from a Lead whose lane closes as it asks is not opened on the closed lane", async () => {
  const { h, sup, lane } = await laneWithPeer();
  const [asked] = await Promise.all([h.call(lane.lead!, "lead", "ask", { kind: "question", text: "Which one?", default: "the first" }), h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" })]);
  assert.equal(asked.ok, false, asked.text);
  assert.deepEqual(Object.values(h.ledger().asks), []);
});

test("an ask from a Peer whose task is cut as it asks is not opened", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const [asked] = await Promise.all([h.call(peer, "peer", "ask", { question: "Which one?", bestGuess: "the first" }), h.call(lane.lead!, "lead", "cut", { task: "L1-T1", reason: "not needed" })]);
  assert.match(asked.text, /L1-T1 was accepted or cut while you asked/);
  assert.deepEqual(Object.values(h.ledger().asks), []);
});
