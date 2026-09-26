import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { worktreeRoot } from "../../server/core/paths.ts";
import { saveLedger } from "../../server/desk/ledger.ts";
import { laneWithPeer } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["anything else in the repository"] };

test("a seat, its branch and its copy's workspace are named for the one duty each has for life, and a copy taken again is named anew", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const title = (id: string) => h.agents.get(id)!.title;
  const slug = h.project.slug;
  const paseo = h.paseo as unknown as {
    workspaces: { create(input: { title: string; source: { path: string } }): Promise<{ id: string }> };
  };
  assert.equal(title(lead), "L1 · Lead · Build");
  assert.equal(title(peer), "L1-T1 · Peer · Clean build");
  await h.call(lead, "lead", "add_tasks", {
    tasks: [{ key: "b", title: "Side", goal: "g", ...scope, holds: ["b.txt"], parallel: true }],
  });
  const side = h.ledger().tasks["L1-T2"]!;
  assert.equal(title(side.peer!), "L1-T2 · Peer · Side");
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  assert.equal((await h.call(lead, "lead", "start_review", { task: "L1-T1", focus: "Is a right?" })).ok, true);
  assert.equal(title(h.ledger().tasks["L1-R1"]!.peer!), "L1-R1 · Review L1-T1");
  assert.equal((await h.call(lead, "lead", "start_review", { focus: "Does the lane meet it?" })).ok, true);
  assert.equal(title(h.ledger().tasks["L1-R2"]!.peer!), "L1-R2 · Review L1");

  assert.equal(h.ledger().tasks["L1-T1"]!.branch, "task/l1-t1-clean-build");
  await h.call(lead, "lead", "add_tasks", {
    tasks: [
      "Add Discount Codes: 10% off!",
      "Money as integer cents, orders migrated",
      "Supercalifragilisticexpialidocious",
    ].map((named, index) => ({ key: `k${index}`, title: named, goal: "g", ...scope, hints: ["a.txt"] })),
  });
  assert.deepEqual(
    ["L1-T3", "L1-T4", "L1-T5"].map((id) => h.ledger().tasks[id]!.branch),
    ["task/l1-t3-add-discount-codes-10", "task/l1-t4-money-as-integer-cents", "task/l1-t5-supercalifragilisticexpi"],
    "cut between words, and inside one only when it alone is longer than the limit",
  );
  await h.call(sup, "supervisor", "open_lane", {
    title: "Chi tiêu định kỳ",
    outcome: "c changes",
    ...scope,
    isolate: true,
  });
  const spending = h.ledger().lanes.L2!;
  assert.equal(spending.branch, "lane/l2-chi-tieu-dinh-ky", "a title in Vietnamese keeps its letters");
  assert.equal(title(spending.lead!), "L2 · Lead · Chi tiêu định kỳ");

  const [beside, own] = [h.ledger().slots[side.slot!]!, h.ledger().slots[spending.slot!]!];
  assert.equal(
    h.workspaceNames.get(beside.workspaceId!),
    `${slug} ${beside.id} · L1-T2 Side`,
    "named for the project, then the work it holds",
  );
  assert.equal(h.workspaceNames.get(own.workspaceId!), `${slug} ${own.id} · L2 Chi tiêu định kỳ`);
  const stray = await paseo.workspaces.create({
    title: `${slug} S8 · L9 Gone`,
    source: { path: join(worktreeRoot(), slug, "S8") },
  });
  await h.tick();
  assert.deepEqual(
    [beside.workspaceId, own.workspaceId, stray.id].map((id) => h.archivedWorkspaces.has(id!)),
    [false, false, true],
    "copies in use are left alone, and one nothing holds is swept",
  );

  // A start that failed after the copy's workspace was made leaves its row free with that workspace: no workflow reaches it.
  const path = join(worktreeRoot(), slug, "S9");
  const kept = await paseo.workspaces.create({ title: `${slug} S9 · L9 Gone`, source: { path } });
  const ledger = h.ledger();
  ledger.slots.S9 = { id: "S9", path, createdAt: 1, workspaceId: kept.id };
  saveLedger(h.project.state, ledger);
  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "d changes", ...scope, isolate: true });
  assert.deepEqual([h.ledger().lanes.L3!.slot, h.ledger().lanes.L3!.workspaceId], ["S9", kept.id]);
  assert.equal(h.workspaceNames.get(kept.id), `${slug} S9 · L3 Order`, "renamed for the work it holds now");

  h.agents.get(lead)!.archivedAt = new Date().toISOString();
  assert.equal((await h.call(sup, "supervisor", "replace_lead", { lane: "L1" })).ok, true);
  const next = h.ledger().lanes.L1!.lead!;
  assert.notEqual(next, lead);
  assert.equal(title(next), "L1 · Lead · Build", "a new Lead for a lane whose Lead is gone is named for that lane");
});
