import assert from "node:assert/strict";
import { test } from "node:test";
import { KEEP_CLOSED_LANES } from "../../server/desk/archive.ts";
import { type Lane, saveLedger } from "../../server/desk/ledger.ts";
import { harness, heldRound, laneWithPeer, nobodySeated } from "./harness.ts";

test("a round the daemon cannot answer moves nothing: the copy is not put back under its seats, and the project's workspace stays", async (t) => {
  const { h, sup, lane, peer } = await laneWithPeer();
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" })).ok, true);
  const home = [...h.workspaceNames].find(([, name]) => name === h.project.slug)![0];
  const branch = h.git(h.root, "branch", "--show-current").trim();
  // As Paseo's client answers while its socket to the daemon is down.
  const agents = (h.paseo as { agents: { list(): Promise<unknown> } }).agents;
  t.mock.method(agents, "list", async () => {
    throw new Error("Transport not connected (status: disconnected)");
  });
  await assert.rejects(h.tick(), /Transport not connected/);

  assert.deepEqual(h.ledger().lanes.L1!.restoring?.writers.sort(), [lane.lead!, peer].sort(), "both seats may still be writing in the copy");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), branch);
  assert.equal(h.archivedWorkspaces.has(home), false);
});

test("a listing with nobody in it is a machine nobody sits at: a copy whose seats have all gone is put back", async () => {
  const { h, sup } = await laneWithPeer();
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" })).ok, true);
  nobodySeated(h);
  await h.tick();
  assert.equal(h.ledger().lanes.L1!.restoring, undefined);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
});

test("with nobody seated, a closed lane older than the ones the ledger keeps is filed", async () => {
  const h = harness();
  const ledger = h.ledger();
  for (let n = 1; n <= KEEP_CLOSED_LANES + 1; n++) {
    ledger.lanes[`L${n}`] = { id: `L${n}`, title: `lane ${n}`, outcome: "", acceptance: [], outOfScope: [], base: "main", branch: `lane/l${n}`, writeSet: [], contracts: [], opener: "sup", status: "closed", openedAt: n, tasks: 0, lead: `lead-${n}` } as Lane;
  }
  ledger.seq.lane = KEEP_CLOSED_LANES + 1;
  saveLedger(h.project.state, ledger);
  await h.tick();
  assert.equal(h.ledger().lanes.L1, undefined);
});

test("with nobody seated, a task whose Peer has gone stalls, and one a stop left with no Peer is cut", async () => {
  const { h } = await laneWithPeer();
  const ledger = h.ledger();
  ledger.tasks["L1-T2"] = { ...ledger.tasks["L1-T1"]!, id: "L1-T2", title: "Straight", peer: undefined, opening: undefined };
  saveLedger(h.project.state, ledger);
  nobodySeated(h);
  await h.tick();

  const tasks = h.ledger().tasks;
  assert.deepEqual([tasks["L1-T1"]!.status, tasks["L1-T1"]!.peerGone], ["stalled", true]);
  assert.equal(tasks["L1-T2"]!.status, "cut");
});

test("with nobody seated, a lane a stop left half-open in the Human's copy is closed and the copy put back", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  h.git(h.root, "switch", "-qc", "lane/l2-aside");
  const ledger = h.ledger();
  ledger.lanes.L2 = { ...ledger.lanes.L1!, id: "L2", title: "Aside", branch: "lane/l2-aside", lead: undefined, slot: undefined, worktree: undefined, workspaceId: undefined };
  ledger.seq.lane = 2;
  saveLedger(h.project.state, ledger);
  nobodySeated(h);
  await h.tick();

  assert.equal(h.ledger().lanes.L2!.status, "closed");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
});

test("a seat started while a round runs is not taken for gone by that round, which listed the seats before it: no task stalls, no Lead is reported gone, no ask moves", async (t) => {
  const { h, sup, lane } = await laneWithPeer();
  const { round, release } = await heldRound(h, t);
  const parallel = (key: string, title: string, owned: string) => ({ tasks: [{ key, title, goal: "g", acceptance: ["a"], owned: [owned], outOfScope: ["the rest of the repository"], parallel: true }] });
  assert.equal((await h.call(lane.lead!, "lead", "add_tasks", parallel("u", "Second", "b.txt"))).ok, true);
  assert.equal((await h.call(sup, "supervisor", "open_lane", { title: "Rounding", outcome: "money rounds correctly", acceptance: ["a"], outOfScope: ["anything else"], isolate: true })).ok, true);
  const other = h.ledger().lanes.L2!;
  assert.equal((await h.call(other.lead!, "lead", "add_tasks", parallel("v", "Third", "c.txt"))).ok, true);
  const third = Object.values(h.ledger().tasks).find((task) => task.title === "Third")!;
  assert.equal((await h.call(third.peer!, "peer", "ask", { question: "Which rounding?", bestGuess: "half up" })).ok, true);
  release();
  await round;

  const second = Object.values(h.ledger().tasks).find((task) => task.title === "Second")!;
  assert.deepEqual([second.status, second.peerGone ?? false], ["running", false]);
  assert.deepEqual(Object.values(h.ledger().asks).map((ask) => ask.to), [other.lead]);
  await h.idle(lane.lead!);
  await h.idle(sup);
  assert.doesNotMatch(h.heard(lane.lead!).join("\n"), /was closed or archived/);
  assert.doesNotMatch(h.heard(sup).join("\n"), /LEAD GONE/);
});
