import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTeam } from "../catalog/team.ts";
import { makeKit } from "../catalog/testkit.ts";
import type { SeatView } from "../core/paseo.ts";
import { flowView } from "./flow.ts";
import { emptyLedger } from "./ledger.ts";
import type { Project, ProjectConfig } from "./project.ts";

const now = Date.parse("2026-09-16T04:00:00.000Z");
const project: Project = { root: "/work/shop", slug: "shop-abc123", state: "/state/shop-abc123" };
const config: ProjectConfig = { base: "main", gate: "npm test", gateTimeoutMinutes: 20, gateOn: "lane", parallelLanes: 1, serialOnly: [] };

function ledgerWithWork() {
  const ledger = emptyLedger();
  ledger.lanes.L1 = {
    id: "L1", title: "Discount codes", outcome: "", acceptance: [], outOfScope: [], base: "main", branch: "lane-l1",
    writeSet: [], contracts: [], lead: "seat-lead", opener: "seat-sup", status: "open", openedAt: now - 3_600_000, tasks: 1,
  };
  ledger.lanes.L0 = {
    id: "L0", title: "Landed already", outcome: "", acceptance: [], outOfScope: [], base: "main", branch: "lane-l0",
    writeSet: [], contracts: [], opener: "seat-sup", status: "closed", openedAt: now - 7_200_000, closedAt: now - 60_000, tasks: 0,
  };
  ledger.tasks["L1-T1"] = {
    id: "L1-T1", lane: "L1", kind: "code", mode: "lane", title: "Percentage codes", goal: "", acceptance: [], owned: [],
    outOfScope: [], peer: "seat-peer", status: "running", openedAt: now - 1_800_000, updatedAt: now - 120_000, silent: 0,
  };
  ledger.tasks["L0-T1"] = {
    id: "L0-T1", lane: "L0", kind: "code", mode: "lane", title: "Old work", goal: "", acceptance: [], owned: [],
    outOfScope: [], status: "merged", openedAt: now - 7_000_000, updatedAt: now - 120_000, silent: 0,
  };
  ledger.asks.A1 = {
    id: "A1", from: "seat-lead", fromRole: "lead", to: "seat-sup", lane: "L1", kind: "question",
    text: "Which rounding do we use?\nThe spec says nothing.", status: "open", openedAt: now - 720_000, reminders: 0,
  };
  ledger.asks.A0 = {
    id: "A0", from: "seat-lead", fromRole: "lead", to: "seat-sup", kind: "need", text: "Answered one", status: "answered",
    openedAt: now - 900_000, reminders: 0,
  };
  ledger.agents["seat-peer"] = { id: "seat-peer", role: "peer", lane: "L1", task: "L1-T1" };
  ledger.agents["seat-lead"] = { id: "seat-lead", role: "lead", lane: "L1" };
  return ledger;
}

const seatMap = new Map<string, SeatView>([
  ["seat-lead", { id: "seat-lead", provider: "sw2-lead-claude", cwd: "/w", status: "idle", updatedAt: new Date(now - 180_000).toISOString() }],
  [
    "seat-peer",
    {
      id: "seat-peer", provider: "sw2-peer-devin", cwd: "/w", status: "running", updatedAt: new Date(now - 60_000).toISOString(),
      pendingPermissions: [{ title: "Write outside the working copy" }],
    },
  ],
]);

test("the flow view carries the open lanes, their tasks and who sits in them", () => {
  const team = resolveTeam(makeKit(), {});
  const view = flowView(project, ledgerWithWork(), config, team, seatMap, now);

  assert.deepEqual(view.lanes.map((lane) => lane.id), ["L1"], "a closed lane is not part of the live flow");
  const lane = view.lanes[0]!;
  assert.equal(lane.branch, "lane-l1");
  assert.deepEqual(lane.lead, { id: "seat-lead", status: "idle", minutes: 3, waiting: [] });
  assert.deepEqual(lane.tasks.map((task) => task.id), ["L1-T1"], "a task belongs to its own lane");
  assert.equal(lane.tasks[0]!.status, "running");
  assert.equal(lane.tasks[0]!.minutes, 2);
  assert.deepEqual(lane.tasks[0]!.peer?.waiting, ["Write outside the working copy"], "a seat waiting on the Human shows what it asked for");
  assert.equal(view.base, "main");
  assert.equal(view.gate, "npm test");
});

test("an open ask reaches the flow with its first line and its age, and an answered one does not", () => {
  const view = flowView(project, ledgerWithWork(), config, resolveTeam(makeKit(), {}), seatMap, now);
  assert.deepEqual(view.asks.map((ask) => ask.id), ["A1"]);
  assert.equal(view.asks[0]!.text, "Which rounding do we use?");
  assert.equal(view.asks[0]!.minutes, 12);
  assert.equal(view.asks[0]!.fromRole, "lead");
});

test("every role of the team is a node, whether or not it has a seat right now", () => {
  const ledger = ledgerWithWork();
  ledger.agents["seat-gone"] = { id: "seat-gone", role: "supervisor" };
  const view = flowView(project, ledger, config, resolveTeam(makeKit(), {}), seatMap, now);

  const byId = new Map(view.roles.map((role) => [role.id, role]));
  assert.deepEqual([...byId.keys()].sort(), ["lead", "peer", "supervisor", "watcher"]);
  assert.deepEqual(byId.get("peer")!.seats.map((seat) => seat.id), ["seat-peer"]);
  assert.equal(byId.get("watcher")!.seats.length, 0, "a headless role holds no seat");
  assert.equal(byId.get("supervisor")!.seats[0]!.status, "gone", "a seat the ledger names but Paseo has lost reads as gone");
});
