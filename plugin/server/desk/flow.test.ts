import assert from "node:assert/strict";
import { test } from "node:test";
import type { SeatView } from "../core/paseo.ts";
import { tempDir } from "../core/testing.ts";
import { flowView } from "./flow.ts";
import { emptyLedger, readLedger, saveLedger } from "./ledger.ts";
import type { Project } from "./project.ts";

const now = Date.parse("2026-09-16T04:00:00.000Z");
const project: Project = { root: "/work/shop", slug: "shop-abc123", state: "/state/shop-abc123" };

function working() {
  const ledger = emptyLedger();
  ledger.lanes.L1 = {
    id: "L1", title: "Discount codes", outcome: "", acceptance: [], outOfScope: [], base: "main", branch: "lane-l1",
    writeSet: [], contracts: [], lead: "seat-lead", opener: "seat-sup", status: "open", openedAt: now - 3_600_000, tasks: 2,
  };
  ledger.lanes.L0 = {
    id: "L0", title: "Landed already", outcome: "", acceptance: [], outOfScope: [], base: "main", branch: "lane-l0",
    writeSet: [], contracts: [], opener: "seat-sup", status: "closed", openedAt: now - 7_200_000, closedAt: now - 60_000, tasks: 0,
  };
  for (const [id, peer, status] of [["L1-T1", "seat-peer", "running"], ["L1-T2", "seat-peer2", "done"]] as const) {
    ledger.tasks[id] = {
      id, lane: "L1", kind: "code", mode: "lane", title: `Task ${id}`, goal: "", acceptance: [], owned: [],
      outOfScope: [], peer, status, openedAt: now - 1_800_000, updatedAt: now - 120_000, silent: 0,
    };
  }
  ledger.tasks["L1-T0"] = {
    id: "L1-T0", lane: "L1", kind: "code", mode: "lane", title: "Already merged", goal: "", acceptance: [], owned: [],
    outOfScope: [], status: "merged", openedAt: now - 5_000_000, updatedAt: now - 300_000, silent: 0,
  };
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
});

test("an open lane carries its own tasks, and finished or closed work stays out", () => {
  const view = flowView(project, working(), seats, now);
  assert.deepEqual(view.lanes.map((lane) => lane.id), ["L1"], "a closed lane is not live");
  const lane = view.lanes[0]!;
  assert.deepEqual(lane.tasks.map((task) => task.id), ["L1-T1", "L1-T2"], "a merged task is not live");
  assert.deepEqual(lane.lead, { id: "seat-lead", role: "lead", status: "idle", minutes: 3, waiting: [] });
  assert.deepEqual(lane.tasks[0]!.peer?.waiting, ["Write outside the working copy"]);
  assert.equal(lane.tasks[1]!.peer?.status, "gone", "a task whose seat Paseo has lost reads as gone");
  assert.equal(view.supervisor?.id, "seat-sup");
  assert.deepEqual(view.asks.map((ask) => [ask.id, ask.text]), [["A1", "Which rounding do we use?"]]);
});

test("the revision only changes when the flow itself changes", () => {
  const first = flowView(project, working(), seats, now);
  const again = flowView(project, working(), seats, now);
  assert.equal(first.revision, again.revision, "the same flow hashes the same, so a poll can be answered with nothing");

  const moved = working();
  moved.tasks["L1-T1"]!.status = "rework";
  assert.notEqual(flowView(project, moved, seats, now).revision, first.revision);
});

test("the ledger is parsed again only when the file on disk has changed", () => {
  const state = tempDir("sw2-flow-state-");
  const ledger = emptyLedger();
  ledger.lanes.L1 = {
    id: "L1", title: "One", outcome: "", acceptance: [], outOfScope: [], base: "main", branch: "lane-l1",
    writeSet: [], contracts: [], opener: "seat-sup", status: "open", openedAt: now, tasks: 0,
  };
  saveLedger(state, ledger);

  const once = readLedger(state);
  assert.equal(readLedger(state), once, "an unchanged file hands back the parse it already has");

  const next = readLedger(state);
  next.lanes.L2 = { ...next.lanes.L1!, id: "L2", title: "Two" };
  saveLedger(state, next);
  const after = readLedger(state);
  assert.notEqual(after, once, "a write drops the cached parse");
  assert.deepEqual(Object.keys(after.lanes).sort(), ["L1", "L2"]);
});
