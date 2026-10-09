import assert from "node:assert/strict";
import { test } from "node:test";
import type { Lane } from "../../server/domain/lane.ts";
import { emptyLedger, rebaseOffLanded } from "../../server/domain/ledger.ts";

const lane = (id: string, base: string, more: Partial<Lane> = {}): Lane => ({
  id,
  title: id,
  outcome: "",
  acceptance: [],
  outOfScope: [],
  base,
  branch: `lane/${id.toLowerCase()}`,
  writeSet: [],
  contracts: [],
  opener: "seat-sup",
  status: "open",
  openedAt: 0,
  tasks: 0,
  ...more,
});

test("a lane still off a landed lane's branch moves onto where that work went, through every lane landed since", () => {
  const ledger = emptyLedger();
  ledger.lanes.L1 = lane("L1", "main", { status: "closed", landed: true });
  ledger.lanes.L2 = lane("L2", "lane/l1", { status: "closed", landed: true });
  ledger.lanes.L3 = lane("L3", "lane/l2");
  ledger.lanes.L4 = lane("L4", "lane/l2", { status: "waiting" });
  ledger.lanes.L5 = lane("L5", "lane/l3");
  ledger.lanes.L6 = lane("L6", "lane/l7", { status: "closed", landed: true });
  ledger.lanes.L7 = lane("L7", "main", { status: "closed" });
  const moved = rebaseOffLanded(ledger).map(({ lane, from, spent }) => [lane.id, from, spent.id]);
  assert.deepEqual(moved, [
    ["L3", "lane/l2", "L2"],
    ["L4", "lane/l2", "L2"],
  ]);
  assert.deepEqual(
    Object.values(ledger.lanes).map((entry) => entry.base),
    ["main", "lane/l1", "main", "main", "lane/l3", "lane/l7", "main"],
  );
  assert.deepEqual(rebaseOffLanded(ledger), []);
});
