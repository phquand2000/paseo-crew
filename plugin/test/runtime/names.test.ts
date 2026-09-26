import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { worktreeRoot } from "../../server/core/paths.ts";
import { saveLedger } from "../../server/desk/ledger.ts";
import { harness, laneWithPeer } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["anything else in the repository"] };

test("a seat is named for the one duty it has for life: its lane or task, its role and the title", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const title = (id: string) => h.agents.get(id)!.title;
  assert.equal(title(lane.lead!), "L1 · Lead · Build");
  assert.equal(title(peer), "L1-T1 · Peer · Clean build");
  await h.call(lane.lead!, "lead", "add_tasks", {
    tasks: [{ key: "b", title: "Side", goal: "g", ...scope, holds: ["b.txt"], parallel: true }],
  });
  assert.equal(title(h.ledger().tasks["L1-T2"]!.peer!), "L1-T2 · Peer · Side");

  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  assert.equal((await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is a right?" })).ok, true);
  assert.equal(title(h.ledger().tasks["L1-R1"]!.peer!), "L1-R1 · Review L1-T1");
  assert.equal(
    (await h.call(lane.lead!, "lead", "start_review", { focus: "Does the lane meet its acceptance?" })).ok,
    true,
  );
  assert.equal(title(h.ledger().tasks["L1-R2"]!.peer!), "L1-R2 · Review L1");

  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "c.txt changes", ...scope, isolate: true });
  assert.equal(title(h.ledger().lanes.L2!.lead!), "L2 · Lead · Order");
});

test("a new Lead for a lane whose Lead is gone is named for that lane", async () => {
  const { h, sup, lane } = await laneWithPeer();
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  assert.equal((await h.call(sup, "supervisor", "replace_lead", { lane: "L1" })).ok, true);
  const next = h.ledger().lanes.L1!.lead!;
  assert.notEqual(next, lane.lead);
  assert.equal(h.agents.get(next)!.title, "L1 · Lead · Build");
});

test("a copy's workspace is named for the project and then the work it holds, which the round's sweep still knows it by", async () => {
  const { h, sup, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", {
    tasks: [{ key: "b", title: "Side", goal: "g", ...scope, holds: ["b.txt"], parallel: true }],
  });
  const side = h.ledger().slots[h.ledger().tasks["L1-T2"]!.slot!]!;
  assert.equal(h.workspaceNames.get(side.workspaceId!), `${h.project.slug} ${side.id} · L1-T2 Side`);
  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "c.txt changes", ...scope, isolate: true });
  const order = h.ledger().slots[h.ledger().lanes.L2!.slot!]!;
  assert.equal(h.workspaceNames.get(order.workspaceId!), `${h.project.slug} ${order.id} · L2 Order`);
  await h.runtime.desk.sweep(h.project);
  assert.deepEqual(
    [h.archivedWorkspaces.has(side.workspaceId!), h.archivedWorkspaces.has(order.workspaceId!)],
    [false, false],
    "copies in use are left alone",
  );
  const ledger = h.ledger();
  delete ledger.slots[side.id]!.workspaceId;
  saveLedger(h.project.state, ledger);
  await h.runtime.desk.sweep(h.project);
  assert.equal(
    h.archivedWorkspaces.has(side.workspaceId!),
    true,
    "and one nothing holds is swept, found by the project's name leading its own",
  );
});

test("a copy taken again keeps its workspace, renamed for the work it holds now", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  // A start that failed after the copy's workspace was made leaves its row free with that workspace.
  const path = join(worktreeRoot(), h.project.slug, "S0");
  const kept = await (
    h.paseo as unknown as { workspaces: { create(input: unknown): Promise<{ id: string }> } }
  ).workspaces.create({ title: `${h.project.slug} S0 · L9 Gone`, source: { path } });
  const ledger = h.ledger();
  ledger.slots.S0 = { id: "S0", path, createdAt: 1, workspaceId: kept.id };
  ledger.seq.slot = 0;
  saveLedger(h.project.state, ledger);
  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "c.txt changes", ...scope, isolate: true });
  assert.deepEqual([h.ledger().lanes.L1!.slot, h.ledger().lanes.L1!.workspaceId], ["S0", kept.id]);
  assert.equal(h.workspaceNames.get(kept.id), `${h.project.slug} S0 · L1 Order`);
});
