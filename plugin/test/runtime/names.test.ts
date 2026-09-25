import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { worktreeRoot } from "../../server/core/paths.ts";
import { saveLedger } from "../../server/desk/ledger.ts";
import { type Pending, harness, laneWithPeer } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["anything else in the repository"] };

test("a seat is named for its team: a new Lead starts one, its Peers and reviewers join it, and no number is used twice", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const named = (id: string) => [h.agents.get(id)!.title, h.agents.get(id)!.labels["seatworks.team"], h.ledger().agents[id]!.team];
  assert.deepEqual(named(lane.lead!), ["Team 1 · Lead", "1", "1"]);
  assert.deepEqual(named(peer), ["Team 1 · Peer 1", "1", "1"]);

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "b", title: "Side", goal: "g", ...scope, owned: ["b.txt"], parallel: true }] });
  assert.deepEqual(named(h.ledger().tasks["L1-T2"]!.peer!), ["Team 1 · Peer 2", "1", "1"]);

  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  assert.equal((await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is a right?" })).ok, true);
  assert.deepEqual(named(h.ledger().tasks["L1-R1"]!.peer!), ["Team 1 · Review L1-T1", "1", "1"]);

  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "c.txt changes", ...scope, isolate: true });
  const second = h.ledger().lanes.L2!;
  assert.deepEqual(named(second.lead!), ["Team 2 · Lead", "2", "2"]);
  await h.call(second.lead!, "lead", "add_tasks", { tasks: [{ key: "c", title: "Form", goal: "g", ...scope, owned: ["c.txt"] }] });
  assert.deepEqual(named(h.ledger().tasks["L2-T1"]!.peer!), ["Team 2 · Peer 1", "2", "2"]);
});

test("a new Lead for a lane whose Lead is gone joins the lane's team", async () => {
  const { h, sup, lane } = await laneWithPeer();
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  assert.equal((await h.call(sup, "supervisor", "replace_lead", { lane: "L1" })).ok, true);
  const next = h.ledger().lanes.L1!.lead!;
  assert.notEqual(next, lane.lead);
  assert.deepEqual([h.agents.get(next)!.title, h.agents.get(next)!.labels["seatworks.team"], h.ledger().agents[next]!.team], ["Team 1 · Lead", "1", "1"]);
});

test("a Lead Paseo seated before a stop is taken on with its team, so its lane's Peers join that team", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a.txt changes", ...scope, isolate: true });
  const lead = h.ledger().lanes.L1!.lead!;
  const ledger = h.ledger();
  delete ledger.lanes.L1!.lead;
  delete ledger.agents[lead];
  saveLedger(h.project.state, ledger);

  await h.tick(Date.now());
  assert.equal(h.ledger().agents[lead]!.team, "1");
  await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "t", title: "Total", goal: "g", ...scope, owned: ["a.txt"] }] });
  assert.equal(h.agents.get(h.ledger().tasks["L1-T1"]!.peer!)!.title, "Team 1 · Peer 1");
});

test("a letter names a seat by its team and by what it works on now", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const command: Pending = { id: "permission-1", kind: "tool", name: "Bash", title: "rm -rf build" };
  h.agents.get(peer)!.pending.push(command);
  await h.permission(peer, command);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /WAITING FOR PERMISSION: Team 1 · Peer 1 on L1-T1 \(Clean build\) has stopped until this is answered\./);

  const seat = h.agents.get(lane.lead!)!;
  const fail = (turnId: string) => h.runtime.turnEnded({ agent: { id: lane.lead!, provider: seat.provider, cwd: seat.cwd, title: seat.title }, turnId, outcome: { kind: "failed", error: { message: "overloaded" } }, timeline: [] });
  await fail("t-1");
  assert.match(h.heard(sup).join("\n"), /FAILED: Team 1 · Lead of L1 \(Build\) ended its turn with an error: overloaded/);

  const ledger = h.ledger();
  Object.assign(ledger.lanes.L1!, { status: "closed", landed: true });
  saveLedger(h.project.state, ledger);
  await fail("t-2");
  assert.match(h.heard(sup).join("\n"), /FAILED: Team 1 · Lead kept from L1 \(Build\) ended its turn with an error: overloaded/);
});

test("a copy's workspace is named for the project and then the work it holds, which the round's sweep still knows it by", async () => {
  const { h, sup, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "b", title: "Side", goal: "g", ...scope, owned: ["b.txt"], parallel: true }] });
  const side = h.ledger().slots[h.ledger().tasks["L1-T2"]!.slot!]!;
  assert.equal(h.workspaceNames.get(side.workspaceId!), `${h.project.slug} ${side.id} · L1-T2 Side`);
  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "c.txt changes", ...scope, isolate: true });
  const order = h.ledger().slots[h.ledger().lanes.L2!.slot!]!;
  assert.equal(h.workspaceNames.get(order.workspaceId!), `${h.project.slug} ${order.id} · L2 Order`);
  await h.runtime.desk.sweep(h.project);
  assert.deepEqual([h.archivedWorkspaces.has(side.workspaceId!), h.archivedWorkspaces.has(order.workspaceId!)], [false, false], "copies in use are left alone");
  const ledger = h.ledger();
  delete ledger.slots[side.id]!.workspaceId;
  saveLedger(h.project.state, ledger);
  await h.runtime.desk.sweep(h.project);
  assert.equal(h.archivedWorkspaces.has(side.workspaceId!), true, "and one nothing holds is swept, found by the project's name leading its own");
});

test("a copy taken again keeps its workspace, renamed for the work it holds now", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  // A start that failed after the copy's workspace was made leaves its row free with that workspace.
  const path = join(worktreeRoot(), h.project.slug, "S0");
  const kept = await (h.paseo as unknown as { workspaces: { create(input: unknown): Promise<{ id: string }> } }).workspaces.create({ title: `${h.project.slug} S0 · L9 Gone`, source: { path } });
  const ledger = h.ledger();
  ledger.slots.S0 = { id: "S0", path, createdAt: 1, workspaceId: kept.id };
  ledger.seq.slot = 0;
  saveLedger(h.project.state, ledger);
  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "c.txt changes", ...scope, isolate: true });
  assert.deepEqual([h.ledger().lanes.L1!.slot, h.ledger().lanes.L1!.workspaceId], ["S0", kept.id]);
  assert.equal(h.workspaceNames.get(kept.id), `${h.project.slug} S0 · L1 Order`);
});
