import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { saveLedger } from "../../server/desk/ledger.ts";
import { harness, laneWithPeer } from "./harness.ts";

test("a lane that waits for another opens by itself once that one lands, off a base that has its work, and its Supervisor is told", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  const scope = { acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", ...scope, writeSet: ["a.txt"] });
  const cart = h.ledger().lanes.L1!;

  const queued = await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "orders from the cart", ...scope, writeSet: ["a.txt"], after: ["l1"] });
  assert.equal(queued.ok, true, queued.text);
  assert.match(queued.text, /Lane L2 waits for L1 \(open\)/);
  const waiting = h.ledger().lanes.L2!;
  assert.deepEqual([waiting.status, waiting.lead, waiting.after], ["waiting", undefined, ["L1"]], "recorded, with nothing started for it");
  assert.equal(h.git(h.root, "branch", "--list", waiting.branch).trim(), "", "and no branch made yet");
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /## Waiting lanes\n\n- L2 Order: after L1 open\n  Outcome: orders from the cart/);

  h.commit(h.root, "a.txt", "cart\n");
  h.agents.get(cart.lead!)!.status = "idle";
  await h.endTurn(cart.lead!, "done");
  const closed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(closed.ok, true, closed.text);
  const order = h.ledger().lanes.L2!;
  assert.deepEqual([order.status, h.ledger().lanes.L1!.landed], ["open", true]);
  assert.ok(order.lead, "its Lead is seated");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), order.branch);
  assert.equal(readFileSync(join(h.root, "a.txt"), "utf-8"), "cart\n", "off a base that has the lane it waited for");
  assert.match(h.heard(sup).join("\n"), /WAITING L2 \(Order\), the lane you opened to wait for L1: Lane L2 is open on lane\/l2-order/);
});

test("a lane waiting for one that closes without landing stays waiting, and its Supervisor is told once until it drops it", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", ...scope, isolate: true });
  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "orders", ...scope, after: ["L1"] });
  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" });
  await h.tick(Date.now());
  await h.tick(Date.now());

  assert.equal(h.ledger().lanes.L2!.status, "waiting");
  const told = h.agents.get(sup)!.sent.filter((text) => text.startsWith("WAITING L2"));
  assert.equal(told.length, 1, told.join("\n---\n"));
  assert.match(told[0]!, /Lane L1 closed without landing, so nothing of it is there to build on/);
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /- L2 Order: after L1 closed without landing\. Not open: Lane L1 closed without landing/);

  assert.match((await h.call(sup, "supervisor", "land_lane", { lane: "L2" })).text, /never opened/);
  const dropped = await h.call(sup, "supervisor", "drop_lane", { lane: "L2", reason: "no longer wanted" });
  assert.match(dropped.text, /was waiting and is dropped/);
  assert.equal(h.ledger().lanes.L2!.status, "closed");
});

test("a waiting lane whose turn comes while an open lane writes its paths is held with the reason, and opens when that lane closes", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", ...scope, writeSet: ["a.txt"], isolate: true });
  await h.call(sup, "supervisor", "open_lane", { title: "Bees", outcome: "bees", ...scope, writeSet: ["b.txt"], isolate: true });
  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "orders", ...scope, writeSet: ["b.txt"], after: ["L1"] });
  // Stopped first, so each close puts its copy away at once instead of leaving it to a later round.
  for (const id of ["L1", "L2"]) h.agents.get(h.ledger().lanes[id]!.lead!)!.status = "idle";

  await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  const held = h.ledger().lanes.L3!;
  assert.equal(held.status, "waiting");
  assert.match(held.held?.why ?? "", /overlaps lane L2 at b\.txt/, "checked again against the lanes open when its turn came");
  const letters = h.agents.get(sup)!.sent.filter((text) => text.startsWith("WAITING L3"));
  assert.equal(letters.length, 1);
  assert.match(letters[0]!, /overlaps lane L2 at b\.txt\.\n\nNext: It opens by itself once that clears; amend it, or close it to drop it\./);
  assert.doesNotMatch(letters[0]!, /open it after L2 lands/, "not told to do what it already does");

  await h.tick(Date.now());
  assert.equal(h.ledger().lanes.L3!.status, "waiting", "a patrol round asks again and finds it still held");
  await h.call(sup, "supervisor", "open_lane", { title: "Aside", outcome: "aside", ...scope, writeSet: [".idea/misc.xml"], isolate: true });
  h.agents.get(h.ledger().lanes.L4!.lead!)!.status = "idle";
  await h.call(sup, "supervisor", "drop_lane", { lane: "L4", reason: "no longer wanted" });
  const told = h.events("lane.held").filter((event) => event.lane === "L3");
  assert.equal(told.length, 1, "tried again when a lane closed, held for the same reason, and not told twice");
  await h.call(sup, "supervisor", "drop_lane", { lane: "L2", reason: "no longer wanted" });
  assert.equal(h.ledger().lanes.L3!.status, "open", "the close that freed its paths opens it");
  assert.equal(h.ledger().lanes.L3!.held, undefined);
  h.agents.get(h.ledger().lanes.L3!.lead!)!.status = "idle";
  await h.call(sup, "supervisor", "drop_lane", { lane: "L3", reason: "no longer wanted" });
});

test("a lane may wait only for lanes that exist and can still land, and one whose lanes have all landed opens at once", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  const open = (extra: Record<string, unknown>) => h.call(sup, "supervisor", "open_lane", { title: "T", ...scope, ...extra });

  assert.match((await open({ after: ["L9"] })).text, /There is no lane L9 to wait for/);
  await open({ isolate: true });
  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" });
  assert.match((await open({ after: ["L1"] })).text, /Lane L1 closed without landing[^]*Open this lane without waiting for it/);
  assert.match((await open({ after: ["L1"], onBranch: true, newBranch: "x" })).text, /A lane that waits cannot start a branch/);

  await open({ onBranch: true });
  const carried = Object.values(h.ledger().lanes).find((lane) => lane.onBranch)!;
  assert.match((await open({ after: [carried.id] })).text, new RegExp(`Lane ${carried.id} carries on main and merges nowhere, so a lane waiting for it carries on that branch too`));
  const behind = await open({ after: [carried.id], onBranch: true });
  assert.equal(behind.ok, true, behind.text);
  assert.equal(Object.values(h.ledger().lanes).find((lane) => lane.status === "waiting")!.branch, "main", "waiting to carry on the branch the lane before it carries");

  await open({ isolate: true, writeSet: ["b.txt"] });
  const landedId = Object.keys(h.ledger().lanes).at(-1)!;
  await h.call(sup, "supervisor", "land_lane", { lane: landedId });
  const now = await open({ after: [landedId], isolate: true });
  assert.match(now.text, /is open on lane\//, "nothing left to wait for, so it opens now");
});

test("a patrol round opens a waiting lane whose lanes landed without it being tried, as after a restart", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", ...scope, isolate: true });
  await h.call(sup, "supervisor", "open_lane", { title: "Order", ...scope, after: ["L1"], isolate: true });
  // The desk stopped between landing L1 and opening what waited for it.
  const ledger = h.ledger();
  Object.assign(ledger.lanes.L1!, { status: "closed", landed: true });
  saveLedger(h.project.state, ledger);

  await h.tick(Date.now());
  assert.equal(h.ledger().lanes.L2!.status, "open");
  assert.ok(h.ledger().lanes.L2!.slot, "in a copy of its own, as it was asked");
});

test("a lane waiting for the project's copy is held while a closed lane's Lead ends its turn there, and a round opens it there once it has", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", ...scope });
  const cart = h.ledger().lanes.L1!;
  await h.call(sup, "supervisor", "open_lane", { title: "Order", ...scope, after: ["L1"] });
  await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.ok(h.ledger().lanes.L1!.restoring, "its Lead is mid-turn, so the copy is still on its branch");
  assert.equal(h.ledger().lanes.L2!.status, "waiting");
  assert.match(h.ledger().lanes.L2!.held?.why ?? "", /its Lead is still ending a turn in the project's own copy/);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), cart.branch, "and the copy the Lead is writing in is not switched under it");

  h.agents.get(cart.lead!)!.status = "idle";
  await h.endTurn(cart.lead!, "stopping");
  await h.tick(Date.now());
  const order = h.ledger().lanes.L2!;
  assert.deepEqual([order.status, order.slot], ["open", undefined], "it waited for the project's copy, as the Supervisor chose, and opened there");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), order.branch);
});

test("work that arrives mid-lane is folded into the lane that owns it, and the lane that needs it opens once it lands", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "add and update cart items", acceptance: ["adds an item"], ...scope, writeSet: ["a.txt"] });
  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "an order from the cart", acceptance: ["orders what is in the cart"], ...scope, writeSet: ["b.txt"], contracts: ["a.txt"], after: ["L1"] });
  const cart = h.ledger().lanes.L1!;
  await h.call(cart.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add to cart", goal: "add an item", acceptance: ["adds an item"], hints: ["a.txt"], outOfScope: ["the rest"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;

  // Ten minutes in, the Human asks for an upsert: it rewrites the code the Peer is writing, so it goes to that lane.
  assert.equal((await h.call(sup, "supervisor", "amend_lane", { lane: "L1", why: "the Human wants an upsert", acceptance: ["adds an item", "upserts an item"] })).ok, true);
  assert.equal((await h.call(cart.lead!, "lead", "amend_task", { task: "L1-T1", why: "the lane now upserts", goal: "upsert an item", acceptance: ["adds an item", "upserts an item"] })).ok, true);
  assert.deepEqual(Object.values(h.ledger().lanes).map((lane) => [lane.id, lane.status]), [["L1", "open"], ["L2", "waiting"]], "no lane of its own, so no second writer on the cart");

  h.commit(h.root, "a.txt", "upsert\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "upsert in place" });
  h.agents.get(peer)!.status = "idle";
  assert.equal((await h.call(cart.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  h.agents.get(cart.lead!)!.status = "idle";
  await h.endTurn(cart.lead!, "ready");
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(landed.ok, true, landed.text);

  const order = h.ledger().lanes.L2!;
  assert.equal(order.status, "open", "the lane that needed the cart opens once it lands");
  assert.equal(readFileSync(join(h.root, "a.txt"), "utf-8"), "upsert\n", "off a base with the cart as amended");
  assert.deepEqual(h.ledger().lanes.L1!.amended?.[0]?.was, { acceptance: ["adds an item"] }, "and the record keeps what the cart was asked first");
});

test("a waiting lane that cannot start is held with why, and a patrol round does not set it up and tear it down again", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  h.git(h.root, "branch", "gone-base");
  await h.call(sup, "supervisor", "open_lane", { title: "First", ...scope, isolate: true });
  await h.call(sup, "supervisor", "open_lane", { title: "Unled", ...scope, after: ["L1"], isolate: true, role: "peer" });
  await h.call(sup, "supervisor", "open_lane", { title: "Baseless", ...scope, after: ["L1"], isolate: true, base: "gone-base" });
  h.git(h.root, "branch", "-D", "gone-base");
  h.agents.get(h.ledger().lanes.L1!.lead!)!.status = "idle";
  await h.call(sup, "supervisor", "land_lane", { lane: "L1" });

  assert.match(h.ledger().lanes.L2!.held?.why ?? "", /peer that can lead a lane|can lead a lane/);
  assert.match(h.ledger().lanes.L3!.held?.why ?? "", /its base branch gone-base no longer exists/);
  const taken = () => h.events("slot.taken").length;
  const before = taken();
  await h.tick(Date.now());
  await h.tick(Date.now());
  assert.equal(taken(), before, "no copy is made and put away again each round");
  assert.deepEqual([h.ledger().lanes.L2!.status, h.ledger().lanes.L3!.status], ["waiting", "waiting"]);

  h.git(h.root, "branch", "gone-base");
  await h.tick(Date.now());
  assert.deepEqual([h.ledger().lanes.L2!.status, h.ledger().lanes.L3!.status], ["waiting", "open"], "a round opens the lane whose base came back, with no lane closing");
  assert.equal(h.ledger().lanes.L3!.held, undefined);
  assert.equal(taken(), before + 1, "and takes its copy then, once");
});

test("a lane waiting to carry on a branch is held if the Human's copy has moved off it by its turn", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  await h.call(sup, "supervisor", "open_lane", { title: "First", ...scope, onBranch: true });
  await h.call(sup, "supervisor", "open_lane", { title: "Then", ...scope, onBranch: true, after: ["L1"] });
  h.git(h.root, "switch", "-qc", "elsewhere");
  h.agents.get(h.ledger().lanes.L1!.lead!)!.status = "idle";
  await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(h.ledger().lanes.L2!.status, "waiting");
  assert.match(h.ledger().lanes.L2!.held?.why ?? "", /it carries on main, and the project's own copy is on elsewhere now/);

  h.git(h.root, "switch", "-q", "main");
  await h.tick(Date.now());
  assert.equal(h.ledger().lanes.L2!.status, "open", "the Human switching back is enough, no lane has to close");
});

test("an amendment changes what an open lane is asked, keeps what it was asked, and tells its Lead what moved and that its READY no longer stands", async () => {
  const { h, sup, lane } = await laneWithPeer();
  const amended = await h.call(sup, "supervisor", "amend_lane", { lane: "L1", why: "the Human wants an upsert too", acceptance: ["a", "upserts an item"] });
  assert.equal(amended.ok, true, amended.text);
  assert.match(amended.text, /its Lead has the change; a READY it reported before no longer stands/);
  const now = h.ledger().lanes.L1!;
  assert.deepEqual(now.acceptance, ["a", "upserts an item"]);
  assert.deepEqual(now.amended?.map((entry) => [entry.by, entry.why, entry.was]), [[sup, "the Human wants an upsert too", { acceptance: ["a"] }]]);
  assert.equal(h.agents.get(lane.lead!)!.sent.some((text) => text.startsWith("AMENDED")), false, "held while it is mid-turn, not pushed into it");
  await h.idle(lane.lead!);
  const letter = h.agents.get(lane.lead!)!.sent.find((text) => text.startsWith("AMENDED L1"))!;
  assert.match(letter, /AMENDED L1 \(Build\): the Human wants an upsert too\n\nacceptance, was:\n- a\nacceptance, now:\n- a\n- upserts an item\n\nA READY you reported before this no longer stands\.\n\nNext: Carry it into the tasks it touches \(amend_task/);
  assert.match(letter, /A READY you reported before this no longer stands/);
  assert.doesNotMatch(letter, /supervisor/i, "a Lead is not shown the word its role hides");

  assert.match((await h.call(sup, "supervisor", "amend_lane", { lane: "L1", why: "again", acceptance: ["a", "upserts an item"] })).text, /Nothing about lane L1 would change/);
  assert.match((await h.call(sup, "supervisor", "amend_lane", { lane: "L1", why: "x", acceptance: [] })).text, /at least one acceptance line/);
  await h.call(sup, "supervisor", "open_lane", { title: "Bees", outcome: "bees", acceptance: ["a"], outOfScope: ["the rest"], writeSet: ["b.txt"], isolate: true });
  assert.match((await h.call(sup, "supervisor", "amend_lane", { lane: "L1", why: "x", writeSet: ["a.txt", "b.txt"] })).text, /(overlaps lane L2 at b\.txt|L2 may already be writing b\.txt)[^]*Leave those paths out of this lane/, "a lane that takes on more paths is checked against the lanes open now");
});

test("a waiting lane is amended in place and opens as it is asked then; a closed one is not amended", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", ...scope, isolate: true });
  await h.call(sup, "supervisor", "open_lane", { title: "Order", outcome: "orders", ...scope, after: ["L1"], isolate: true });
  const amended = await h.call(sup, "supervisor", "amend_lane", { lane: "L2", why: "orders need an upserted cart", outcome: "orders from an upserted cart" });
  assert.match(amended.text, /Lane L2 is amended; it opens as it is now/);

  await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  const order = h.ledger().lanes.L2!;
  assert.equal(order.status, "open");
  assert.match(h.agents.get(order.lead!)!.prompt ?? "", /Outcome: orders from an upserted cart/, "its Lead is briefed on what it is asked now");
  assert.match((await h.call(sup, "supervisor", "amend_lane", { lane: "L1", why: "x", outcome: "y" })).text, /Lane L1 is closed/);
});

test("a Lead amends a task its Peer is on: the Peer is told at its next turn", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const amended = await h.call(lane.lead!, "lead", "amend_task", { task: "L1-T1", why: "the lane now wants an upsert", goal: "upsert into the cart" });
  assert.equal(amended.ok, true, amended.text);
  assert.match(amended.text, /L1-T1 is amended; its Peer has it at its next turn/);
  const task = h.ledger().tasks["L1-T1"]!;
  assert.deepEqual([task.goal, task.amended?.[0]?.was], ["upsert into the cart", { goal: "g" }]);
  await h.idle(peer);
  const letter = h.agents.get(peer)!.sent.find((text) => text.startsWith("AMENDED L1-T1"))!;
  assert.match(letter, /goal, was:\ng\ngoal, now:\nupsert into the cart\n\nNext: Work to it as it stands now/);
  assert.doesNotMatch(letter, /seat|supervisor|paseo/i, "a Peer is not shown the words its role hides");

  await h.call(lane.lead!, "lead", "cut", { task: "L1-T1", reason: "done with it" });
  assert.match((await h.call(lane.lead!, "lead", "amend_task", { task: "L1-T1", why: "x", goal: "y" })).text, /L1-T1 is cut; start a task for what is asked now/);
});

test("a waiting lane asked to open by a round and a close at once opens once, with one Lead", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", ...scope, isolate: true });
  await h.call(sup, "supervisor", "open_lane", { title: "Order", ...scope, after: ["L1"], isolate: true });
  const ledger = h.ledger();
  Object.assign(ledger.lanes.L1!, { status: "closed", landed: true });
  saveLedger(h.project.state, ledger);

  await Promise.all([h.runtime.desk.openWaiting(h.project), h.runtime.desk.openWaiting(h.project)]);
  assert.equal(h.ledger().lanes.L2!.status, "open");
  assert.equal([...h.agents.values()].filter((agent) => agent.title.startsWith("L2 · Lead")).length, 1, "both passed the checks, and only one claimed it");
  assert.equal(Object.values(h.ledger().slots).filter((slot) => slot.lane === "L2").length, 1, "and only one copy was taken for it");
});

test("a task that waits for another starts by itself once that one is accepted, as it was amended, and its Lead is told", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const queued = await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "t", title: "Receipt", goal: "show the total", acceptance: ["a"], hints: ["b.txt"], outOfScope: ["the rest"], after: ["l1-t1"] }] });
  assert.equal(queued.ok, true, queued.text);
  assert.match(queued.text, /T is L1-T2 Receipt: waits for L1-T1/);
  assert.deepEqual([h.ledger().tasks["L1-T2"]!.status, h.ledger().tasks["L1-T2"]!.peer], ["waiting", undefined], "recorded, with no Peer started");
  assert.match((await h.call(lead, "lead", "status", {})).text, /- L1-T2 Receipt: waiting, after L1-T1/);
  assert.match((await h.call(lead, "lead", "accept", { task: "L1-T2" })).text, /L1-T2 is waiting/);
  assert.match((await h.call(lead, "lead", "amend_task", { task: "L1-T2", why: "the Human wants tax on it", goal: "show the total with tax" })).text, /L1-T2 is amended; it starts as it is now/);

  h.commit(lane.worktree!, "a.txt", "T1\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "done" });
  h.agents.get(peer)!.status = "idle";
  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);

  const started = h.ledger().tasks["L1-T2"]!;
  assert.equal(started.status, "running");
  assert.equal(h.agents.get(started.peer!)!.cwd, lane.worktree, "in the lane's working copy, now that L1-T1 has left it");
  assert.equal(started.startSha, h.git(lane.worktree!, "rev-parse", "HEAD").trim(), "and it starts from the lane as L1-T1 left it");
  assert.match(h.agents.get(started.peer!)!.prompt ?? "", /TASK L1-T2: Receipt[^]*show the total with tax/, "its brief as amended is its own Peer's first prompt");
  await h.idle(lead);
  assert.match(h.agents.get(lead)!.sent.join("\n"), /WAITING L1-T2 \(Receipt\), the task you started to wait for L1-T1: Started L1-T2 in the lane's working copy/);
});

test("a task waits only for tasks of its own lane, one waiting for a cut task is held and its Lead told, and closing the lane cuts it", async () => {
  const { h, sup, lane } = await laneWithPeer();
  const lead = lane.lead!;
  const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Other", outcome: "x", ...scope, isolate: true });
  const other = h.ledger().lanes.L2!;
  await h.call(other.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Theirs", goal: "g", ...scope, hints: ["c.txt"] }] });
  assert.match((await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "t", title: "T", goal: "g", ...scope, hints: ["b.txt"], after: ["L2-T1"] }] })).text, /There is no task in this lane L2-T1 to wait for/);

  await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "t", title: "Receipt", goal: "g", ...scope, hints: ["b.txt"], after: ["L1-T1"] }] });
  await h.call(lead, "lead", "cut", { task: "L1-T1", reason: "wrong approach" });
  const held = h.ledger().tasks["L1-T2"]!;
  assert.equal(held.status, "waiting");
  assert.match(held.held?.why ?? "", /L1-T1 was cut, so nothing of it is there to build on/);
  await h.tick(Date.now());
  await h.idle(lead);
  const mail = h.agents.get(lead)!.sent.join("\n---\n");
  assert.equal(mail.match(/WAITING L1-T2/g)?.length, 1, mail);
  assert.match((await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "t", title: "Again", goal: "g", ...scope, hints: ["b.txt"], after: ["L1-T1"] }] })).text, /L1-T1 was cut[^]*Take it out of after/);

  h.agents.get(lead)!.status = "idle";
  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" });
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "cut", "a task still waiting when its lane closes goes with it");
});

test("a task whose turn comes while another holds the lane's copy is held with why, and starts once that one is accepted", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
  await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "t", title: "Beside", goal: "g", ...scope, holds: ["b.txt"], parallel: true }] });
  await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "t", title: "After beside", goal: "g", ...scope, hints: ["c.txt"], after: ["L1-T2"] }] });
  const beside = h.ledger().tasks["L1-T2"]!;
  h.commit(beside.worktree!, "b.txt", "B\n");
  await h.call(beside.peer!, "peer", "done", { outcome: "complete", summary: "b" });
  h.agents.get(beside.peer!)!.status = "idle";
  await h.tick(Date.now());
  assert.deepEqual([h.ledger().tasks["L1-T3"]!.status, h.ledger().tasks["L1-T3"]!.held], ["waiting", undefined], "handed back is not accepted, so its turn has not come");
  await h.call(lead, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  await h.tick(Date.now());

  const waiting = h.ledger().tasks["L1-T3"]!;
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(waiting.status, "waiting", "a round finds its turn has come, but L1-T1 still writes in the lane's copy");
  assert.match(waiting.held?.why ?? "", /L1-T1 is still writing in the lane's working copy[^]*It starts by itself once that clears/);

  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(peer)!.status = "idle";
  await h.call(lead, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T3"]!.status, "running", "accepting what held the copy starts it");
  assert.equal(h.ledger().tasks["L1-T3"]!.held, undefined);
});
