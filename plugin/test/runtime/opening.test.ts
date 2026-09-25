import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "./harness.ts";

test("a Lead is told what its lane writes, what it depends on, and what only one writer at a time may write", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Build", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["z"], writeSet: ["a.txt", "package-lock.json"], contracts: ["b.txt"] });
  const directive = h.agents.get(h.ledger().lanes.L1!.lead!)!.prompt ?? "";
  assert.match(directive, /^Writes: a\.txt, package-lock\.json\. A change outside these is flagged at hand-back and at landing; if the work needs more, ask with kind need\.$/m);
  assert.match(directive, /^Depends on: b\.txt, which this lane uses and does not write\.$/m);
  assert.match(directive, /^One writer at a time: package-lock\.json\. A task that writes any of these works in the lane's working copy, not in parallel\.$/m, "read from the files the lane's copy holds");
  assert.match(directive, /^Gate: /m);
});

test("a lane opened with no write set beside lanes that may write a one-writer path is let open, and its Lead and Supervisor are told which and by whom", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { acceptance: ["a"], outOfScope: ["z"], isolate: true };
  await h.call(sup, "supervisor", "open_lane", { title: "Deps", outcome: "a new library", ...scope, writeSet: ["package-lock.json", "a.txt"] });
  await h.call(sup, "supervisor", "open_lane", { title: "Copy", outcome: "b.txt reads well", ...scope, writeSet: ["b.txt"] });
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Loose", outcome: "whatever it takes", ...scope });
  assert.equal(opened.ok, true, "not declaring is the Supervisor's call, not a refusal");
  assert.match(opened.text, /It declared no write set, so it opened beside lanes that may be writing what only one lane at a time may write: L1 \(package-lock\.json\)\. Its Lead is told to leave those to them; amend_lane can give it a write set\./);
  const directive = h.agents.get(h.ledger().lanes.L3!.lead!)!.prompt ?? "";
  assert.match(directive, /^Writes: not declared, so lanes opened after this one are kept off every path this project keeps to one writer\. Lanes already open may be writing what only one lane at a time may write: L1 \(package-lock\.json\)\. Leave those to them until they land, or ask with kind need\.$/m);
  assert.doesNotMatch(h.agents.get(h.ledger().lanes.L2!.lead!)!.prompt ?? "", /Lanes already open/, "a lane that declared its write set keeps to it");
});

test("a lane whose Lead cannot start keeps no copy on record: the one it took is given back", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const paseo = h.paseo as unknown as { workspaces: { ref(id: string): { agents: { create(options: unknown): Promise<unknown> } } } };
  const ref = paseo.workspaces.ref;
  paseo.workspaces.ref = (id) => ({ ...ref(id), agents: { create: async () => Promise.reject(new Error("no seat today")) } });
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Build", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["z"], isolate: true });
  assert.match(opened.text, /The Lead could not start: no seat today/);
  const lane = h.ledger().lanes.L1!;
  assert.deepEqual([lane.status, lane.slot, lane.worktree, lane.workspaceId, Object.keys(h.ledger().slots)], ["closed", undefined, undefined, undefined, []]);
});

test("a Lead is told how its project gates: per task, a task beside others joins the lane red only over the gate with a reason", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { acceptance: ["a"], outOfScope: ["z"], isolate: true };
  // Per task unless the project says otherwise: the lane takes a task only once it is tested with the lane in it.
  assert.match((await h.call(sup, "supervisor", "set_project", { gate: "npm test" })).text, /gate npm test, run per task/);
  await h.call(sup, "supervisor", "open_lane", { title: "Per task", outcome: "x", ...scope });
  assert.match(h.agents.get(h.ledger().lanes.L1!.lead!)!.prompt ?? "", /^Gate: npm test runs on every task, and its verdict reaches the Lead with the hand-back\. A task beside others runs it with the lane brought in, and the lane takes it red only when its Lead accepts it over the gate with a reason$/m);
  await h.call(sup, "supervisor", "set_project", { gateOn: "lane" });
  await h.call(sup, "supervisor", "open_lane", { title: "Per lane", outcome: "y", ...scope });
  assert.match(h.agents.get(h.ledger().lanes.L2!.lead!)!.prompt ?? "", /^Gate: npm test runs on the whole lane when you report it ready; merges are not gated, so the lane branch can break between reports$/m);
});
