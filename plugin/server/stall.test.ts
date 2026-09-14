import assert from "node:assert/strict";
import { test } from "node:test";
import { settle } from "./asks.ts";
import { type Seat, PARENT_LABEL, stalledLeads, statusText } from "./stall.ts";

const now = Date.parse("2026-09-15T10:00:00Z");
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

function seat(id: string, status: string, updated: number, parent?: string): Seat {
  return { id, title: id, provider: "sw2-x", cwd: "/repo", status, updatedAt: minutesAgo(updated), labels: parent ? { [PARENT_LABEL]: parent } : {} };
}

test("an idle Lead with no running seat and no open request is stalled once per idle period", () => {
  const lead = seat("lead-1", "idle", 20, "sup-1");
  const flagged = new Map<string, string>();
  assert.deepEqual(
    stalledLeads([lead], [lead], [], now, 15 * 60_000, flagged).map((entry) => entry.id),
    ["lead-1"],
  );
  flagged.set(lead.id, lead.updatedAt);
  assert.deepEqual(stalledLeads([lead], [lead], [], now, 15 * 60_000, flagged), []);
});

test("a Lead is not stalled while a seat under it runs, while it asks, or before the threshold", () => {
  const lead = seat("lead-1", "idle", 20);
  const running = seat("peer-1", "running", 1, "lead-1");
  assert.deepEqual(stalledLeads([lead], [lead, running], [], now, 15 * 60_000, new Map()), []);
  const asks = settle([], "lead-1", "lead-1", [{ kind: "NEED", text: "NEED: slot" }], now).asks;
  assert.deepEqual(stalledLeads([lead], [lead], asks, now, 15 * 60_000, new Map()), []);
  assert.deepEqual(stalledLeads([seat("lead-2", "idle", 5)], [], [], now, 15 * 60_000, new Map()), []);
  assert.deepEqual(stalledLeads([seat("lead-3", "running", 40)], [], [], now, 15 * 60_000, new Map()), []);
});

test("the status file lists Leads with their seats and the open requests", () => {
  const lead = seat("lead-1", "idle", 20);
  const peer = seat("peer-1", "running", 1, "lead-1");
  const asks = settle([], "lead-1", "Lead A", [{ kind: "NEED", text: "NEED: slot\nmore" }], now - 5 * 60_000).asks;
  const text = statusText("/repo", [lead], [lead, peer], asks, now);
  assert.match(text, /lead-1 \(lead-1\): idle 20 min; seats 1, running 1/);
  assert.match(text, /NEED from Lead A \(lead-1\), open 5 min: NEED: slot/);
});
