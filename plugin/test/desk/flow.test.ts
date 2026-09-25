import assert from "node:assert/strict";
import { test } from "node:test";
import type { SeatView } from "../../server/core/paseo.ts";
import { tempDir } from "../tempdir.ts";
import { flowView } from "../../server/desk/flow.ts";
import { emptyLedger, nextSlotId, readLedger, saveLedger } from "../../server/desk/ledger.ts";
import type { Project } from "../../server/desk/project.ts";

const now = Date.parse("2026-09-16T04:00:00.000Z");
const project: Project = { root: "/work/shop", slug: "shop-abc123", state: "/state/shop-abc123" };

function lane(id: string, status: "open" | "closed", lead?: string) {
  return {
    id, title: `Lane ${id}`, outcome: "", acceptance: [], outOfScope: [], base: "main", branch: `lane-${id.toLowerCase()}`,
    writeSet: [], contracts: [], lead, opener: "seat-sup", status, openedAt: now - 3_600_000, tasks: 0,
  };
}

function task(id: string, laneId: string, status: string, peer?: string) {
  return {
    id, lane: laneId, kind: "code" as const, mode: "lane" as const, title: `Task ${id}`, goal: "", acceptance: [], hints: [], holds: [],
    outOfScope: [], peer, status: status as never, openedAt: now - 1_800_000, updatedAt: now - 120_000, silent: 0,
  };
}

function working() {
  const ledger = emptyLedger();
  ledger.lanes.L1 = lane("L1", "open", "seat-lead");
  ledger.lanes.L2 = lane("L2", "open", "seat-lead2");
  ledger.lanes.L0 = lane("L0", "closed");
  ledger.tasks["L1-T1"] = task("L1-T1", "L1", "running", "seat-peer");
  ledger.tasks["L1-T2"] = task("L1-T2", "L1", "done", "seat-peer2");
  ledger.tasks["L1-T0"] = task("L1-T0", "L1", "merged");
  ledger.tasks["L2-T1"] = task("L2-T1", "L2", "rework", "seat-peer3");
  ledger.asks.A1 = {
    id: "A1", from: "seat-lead", fromRole: "lead", to: "seat-sup", lane: "L1", kind: "question",
    text: "Which rounding do we use?\nThe spec says nothing.", status: "open", openedAt: now - 720_000, reminders: 0,
  };
  ledger.agents["seat-sup"] = { id: "seat-sup", role: "supervisor" };
  return ledger;
}

const seats = new Map<string, SeatView>([
  ["seat-lead", { id: "seat-lead", provider: "sw2-lead-claude", cwd: "/w", status: "idle", updatedAt: new Date(now - 180_000).toISOString() }],
  ["seat-peer", { id: "seat-peer", provider: "sw2-peer-claude", cwd: "/w", status: "running", updatedAt: new Date(now - 60_000).toISOString(), pendingPermissions: [{ title: "Write outside the working copy" }] }],
  ["seat-sup", { id: "seat-sup", provider: "sw2-supervisor-claude", cwd: "/w", status: "idle", updatedAt: new Date(now - 600_000).toISOString() }],
]);

test("a project with nothing running draws nothing", () => {
  const view = flowView(project, emptyLedger(), new Map(), now);
  assert.deepEqual(view.lanes, []);
  assert.deepEqual(view.asks, []);
  assert.deepEqual(view.supervisors, []);
  assert.equal(view.moreLanes, 0);
});

test("whoever supervises is whoever the kit says supervises, not a seat with a particular name", () => {
  assert.deepEqual(flowView(project, working(), seats, now).supervisors, [], "told of no supervising role, the view names no supervisor");
  const shown = flowView(project, working(), seats, now, new Set(), new Set(["supervisor"])).supervisors;
  assert.deepEqual(shown.map((seat) => [seat.id, seat.role]), [["seat-sup", "supervisor"]], "the view reports the role the ledger recorded, not one it assumed");
  assert.deepEqual(flowView(project, working(), seats, now, new Set(), new Set(["architecture"])).supervisors, []);
});

test("the supervisor shown is the one seated now, not the first one the project ever recorded", () => {
  const ledger = working();
  ledger.agents["seat-sup2"] = { id: "seat-sup2", role: "supervisor" };
  const later = new Map(seats);
  later.delete("seat-sup");
  later.set("seat-sup2", { id: "seat-sup2", provider: "sw2-supervisor-claude", cwd: "/w", status: "running", updatedAt: new Date(now - 30_000).toISOString() });

  // `ledger.agents` is never pruned and keeps insertion order, so the first Supervisor ever was shown for ever.
  const shown = flowView(project, ledger, later, now, new Set(), new Set(["supervisor"])).supervisors;
  assert.deepEqual(shown.map((seat) => [seat.id, seat.status]), [["seat-sup2", "running"]], "the gone one is not shown beside a seated one of the same concern");

  const none = flowView(project, ledger, new Map(), now, new Set(), new Set(["supervisor"])).supervisors;
  assert.deepEqual(none.map((seat) => [seat.id, seat.status]), [["seat-sup2", "gone"]]);
});

test("several seats supervising a project are all shown, each for its own concern", () => {
  const ledger = working();
  ledger.agents["seat-arch"] = { id: "seat-arch", role: "architecture" };
  ledger.agents["seat-safety"] = { id: "seat-safety", role: "safety" };
  const both = new Map(seats);
  both.set("seat-arch", { id: "seat-arch", provider: "sw2-architecture-claude", cwd: "/w", status: "idle", updatedAt: new Date(now - 60_000).toISOString() });
  // The concept has several supervisors by concern, and a concern whose seat has gone still shows, as gone.
  const view = flowView(project, ledger, both, now, new Set(), new Set(["supervisor", "architecture", "safety"]));
  assert.deepEqual(view.supervisors.map((seat) => [seat.role, seat.status]).sort(), [["architecture", "idle"], ["safety", "gone"], ["supervisor", "idle"]]);
});

test("a closed lane is counted by nobody and a shut lane carries counts instead of tasks", () => {
  const view = flowView(project, working(), seats, now);
  assert.deepEqual(view.lanes.map((entry) => entry.id), ["L1", "L2"], "a closed lane is not live");
  const first = view.lanes[0]!;
  assert.deepEqual(first.tasks, [], "a lane the screen has not opened sends no task");
  assert.equal(first.taskCount, 2, "a merged task counts for nothing");
  assert.equal(first.running, 1);
  assert.equal(first.open, false);
  assert.deepEqual(first.lead, { id: "seat-lead", role: "lead", status: "idle", minutes: 3, waiting: [] });
});

test("opening one lane sends that lane's tasks and leaves the others counted", () => {
  const view = flowView(project, working(), seats, now, new Set(["L1"]));
  const [first, second] = view.lanes;
  assert.equal(first!.open, true);
  assert.deepEqual(first!.tasks.map((entry) => entry.id), ["L1-T1", "L1-T2"]);
  assert.deepEqual(first!.tasks[0]!.peer?.waiting, ["Write outside the working copy"]);
  assert.equal(first!.tasks[1]!.peer?.status, "gone", "a task whose seat Paseo has lost reads as gone");
  assert.deepEqual(second!.tasks, [], "the lane nobody opened stays a single row");
  assert.equal(second!.taskCount, 1);
});

test("a machine with more lanes than the screen can draw reports the rest as a number", () => {
  const ledger = emptyLedger();
  for (let index = 0; index < 60; index += 1) ledger.lanes[`L${index}`] = lane(`L${index}`, "open");
  const view = flowView(project, ledger, new Map(), now);
  assert.equal(view.lanes.length, 50);
  assert.equal(view.moreLanes, 10);
});

test("the revision changes with what is drawn, so an unchanged poll costs nothing", () => {
  const shut = flowView(project, working(), seats, now);
  assert.equal(shut.revision, flowView(project, working(), seats, now).revision);
  assert.notEqual(flowView(project, working(), seats, now, new Set(["L1"])).revision, shut.revision, "opening a lane is a change");
});

test("an open ask reaches the flow with its first line, and an answered one does not", () => {
  const ledger = working();
  ledger.asks.A0 = { id: "A0", from: "seat-lead", fromRole: "lead", to: "seat-sup", kind: "need", text: "Answered", status: "answered", openedAt: now, reminders: 0 };
  const view = flowView(project, ledger, seats, now);
  assert.deepEqual(view.asks.map((ask) => [ask.id, ask.text, ask.minutes]), [["A1", "Which rounding do we use?", 12]]);
});

test("the ledger is parsed again only when the file on disk has changed", () => {
  const state = tempDir("sw2-flow-state-");
  const ledger = emptyLedger();
  ledger.lanes.L1 = lane("L1", "open");
  saveLedger(state, ledger);

  const once = readLedger(state);
  assert.equal(readLedger(state), once, "an unchanged file hands back the parse it already has");

  const next = readLedger(state);
  next.lanes.L2 = lane("L2", "open");
  saveLedger(state, next);
  const after = readLedger(state);
  assert.notEqual(after, once, "a write drops the cached parse");
  assert.deepEqual(Object.keys(after.lanes).sort(), ["L1", "L2"]);
});

test("a working copy given back does not hand its name to the next one while a later copy still holds it", () => {
  const ledger = emptyLedger();
  ledger.slots.S0 = { id: "S0", path: "/w/shop/S0", createdAt: now, task: "L1-T1" };
  ledger.slots.S1 = { id: "S1", path: "/w/shop/S1", createdAt: now + 1, task: "L1-T2" };
  delete ledger.slots.S0;
  assert.equal(nextSlotId(ledger), "S2", "S1 is still being written in, and naming the next copy S1 would send a second agent into it");
  ledger.slots.S2 = { id: "S2", path: "/w/shop/S2", createdAt: now + 2 };
  assert.equal(nextSlotId(ledger), "S3");
});

test("a lane carrying on the Human's branch is drawn without a base, so it never reads as a branch off itself", () => {
  const ledger = working();
  ledger.lanes.L2 = { ...ledger.lanes.L2!, base: "fix/login", branch: "fix/login", onBranch: true };
  const lanes = flowView(project, ledger, seats, now).lanes;
  assert.deepEqual(lanes.map((lane) => [lane.id, lane.branch, lane.base]), [["L1", "lane-l1", "main"], ["L2", "fix/login", undefined]]);
});

test("a lane waiting on others is drawn with what it waits for and why it is not open yet", () => {
  const ledger = working();
  ledger.lanes.L3 = { ...lane("L3", "open"), status: "waiting", after: ["L1"] };
  ledger.lanes.L4 = { ...lane("L4", "open"), status: "waiting", after: ["L0"], held: { why: "Lane L0 closed without landing." } };
  const [waits, held] = flowView(project, ledger, seats, now).lanes.slice(2);
  assert.deepEqual([waits!.id, waits!.status, waits!.after, waits!.held, waits!.lead], ["L3", "waiting", ["L1"], undefined, null]);
  assert.deepEqual([held!.id, held!.held], ["L4", "Lane L0 closed without landing."]);
});

test("the view is plain JSON as Paseo checks it, with no field left undefined, whatever the lanes hold", () => {
  const ledger = working();
  ledger.lanes.L2 = { ...ledger.lanes.L2!, base: "fix/login", branch: "fix/login", onBranch: true };
  ledger.lanes.L3 = { ...lane("L3", "open"), status: "waiting", after: ["L1"] };
  const view = flowView(project, ledger, seats, now);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(view)), view, "Paseo refuses a reply with an undefined field, and the panel shows the flow as unreadable");
});


test("a task says whether it runs beside the others and in which copy, and a waiting one what it waits for or why it is held", () => {
  const ledger = working();
  ledger.tasks["L1-T3"] = { ...task("L1-T3", "L1", "running", "seat-peer"), mode: "parallel", branch: "task-l1-t3", slot: "S2", worktree: "/w/shop/S2" };
  ledger.tasks["L1-T4"] = { ...task("L1-T4", "L1", "waiting"), after: ["L1-T1", "L1-T3"] };
  ledger.tasks["L1-T5"] = { ...task("L1-T5", "L1", "waiting"), held: { why: "L1-T1 is still writing in the lane's working copy." } };
  const tasks = Object.fromEntries(flowView(project, ledger, seats, now, new Set(["L1"])).lanes[0]!.tasks.map((entry) => [entry.id, entry]));
  assert.deepEqual([tasks["L1-T1"]!.mode, tasks["L1-T1"]!.copy, tasks["L1-T1"]!.after, tasks["L1-T1"]!.held], ["lane", null, [], null], "a task in the lane's copy works where its Lead's lane does");
  assert.deepEqual([tasks["L1-T3"]!.mode, tasks["L1-T3"]!.copy], ["parallel", "S2"]);
  assert.deepEqual(tasks["L1-T4"]!.after, ["L1-T1", "L1-T3"]);
  assert.equal(tasks["L1-T5"]!.held, "L1-T1 is still writing in the lane's working copy.");
});

test("a lane says whether it works in the Human's checkout or a copy of its own", () => {
  const ledger = working();
  ledger.lanes.L2 = { ...ledger.lanes.L2!, slot: "S1", worktree: "/w/shop/S1" };
  assert.deepEqual(flowView(project, ledger, seats, now).lanes.map((entry) => [entry.id, entry.copy]), [["L1", null], ["L2", "S1"]]);
});

test("a Lead kept after its lane closed is drawn until it goes, with the copy it keeps, and a Peer kept idle in a lane's copy is drawn with that lane", () => {
  const ledger = working();
  ledger.lanes.L0 = { ...lane("L0", "closed", "seat-kept"), landed: true, slot: "S3", worktree: "/w/shop/S3" };
  ledger.slots.S3 = { id: "S3", path: "/w/shop/S3", createdAt: now, lane: "L0" };
  ledger.lanes.L5 = { ...lane("L5", "closed", "seat-dropped"), landed: false };
  ledger.tasks["L1-T0"] = { ...ledger.tasks["L1-T0"]!, peer: "seat-idle" };
  ledger.agents["seat-idle"] = { id: "seat-idle", role: "peer", lane: "L1", task: "L1-T0" };
  ledger.tasks["L1-T9"] = { ...ledger.tasks["L1-T0"]!, id: "L1-T9", peer: "seat-idle-2" };
  ledger.agents["seat-idle-2"] = { id: "seat-idle-2", role: "peer", lane: "L1", task: "L1-T9" };
  ledger.tasks["L1-T8"] = { ...ledger.tasks["L1-T0"]!, id: "L1-T8", peer: "seat-released" };
  ledger.agents["seat-released"] = { id: "seat-released", role: "peer", lane: "L1", task: "L1-T8", gone: true };
  const kept = new Map(seats);
  for (const id of ["seat-kept", "seat-dropped", "seat-idle", "seat-idle-2", "seat-released"]) kept.set(id, { id, provider: "sw2-lead-claude", cwd: "/w", status: "idle", updatedAt: new Date(now - 60_000).toISOString() });
  const view = flowView(project, ledger, kept, now);
  assert.deepEqual(view.lanes.map((entry) => [entry.id, entry.status, entry.landed, entry.copy]), [["L1", "open", undefined, null], ["L2", "open", undefined, null], ["L0", "closed", true, "S3"], ["L5", "closed", false, null]]);
  assert.deepEqual(view.lanes[0]!.kept.map((seat) => seat.id), ["seat-idle", "seat-idle-2"], "each Peer kept after its task, until released");
  assert.deepEqual(view.lanes[1]!.kept, []);
  kept.delete("seat-kept");
  kept.delete("seat-idle");
  const gone = flowView(project, ledger, kept, now);
  assert.deepEqual(gone.lanes.map((entry) => entry.id), ["L1", "L2", "L5"], "a closed lane whose Lead was released is not live");
  assert.deepEqual(gone.lanes[0]!.kept.map((seat) => seat.id), ["seat-idle-2"]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(view)), view);
});
