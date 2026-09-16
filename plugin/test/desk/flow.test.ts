import assert from "node:assert/strict";
import { test } from "node:test";
import type { SeatView } from "../../server/core/paseo.ts";
import { tempDir } from "../../server/core/testing.ts";
import { flowView } from "../../server/desk/flow.ts";
import { emptyLedger, readLedger, saveLedger } from "../../server/desk/ledger.ts";
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
    id, lane: laneId, kind: "code" as const, mode: "lane" as const, title: `Task ${id}`, goal: "", acceptance: [], owned: [],
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
  ["seat-peer", { id: "seat-peer", provider: "sw2-peer-devin", cwd: "/w", status: "running", updatedAt: new Date(now - 60_000).toISOString(), pendingPermissions: [{ title: "Write outside the working copy" }] }],
  ["seat-sup", { id: "seat-sup", provider: "sw2-supervisor-claude", cwd: "/w", status: "idle", updatedAt: new Date(now - 600_000).toISOString() }],
]);

test("a project with nothing running draws nothing", () => {
  const view = flowView(project, emptyLedger(), new Map(), now);
  assert.deepEqual(view.lanes, []);
  assert.deepEqual(view.asks, []);
  assert.equal(view.supervisor, null);
  assert.equal(view.moreLanes, 0);
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
  const view = flowView(project, ledger, new Map(), now, new Set(), 50);
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
