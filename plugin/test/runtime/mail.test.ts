import assert from "node:assert/strict";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";
import { sentBy } from "../../server/core/sent-by.ts";
import { harness, laneWithPeer } from "./harness.ts";

test("what the desk sends a seat carries the kinds of its letters in its id, its first prompt too, so the watch tells it from a person's words", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Kinds", outcome: "x", acceptance: ["y"], outOfScope: ["anything else in the repository"] });
  const lead = h.ledger().lanes.L1!.lead!;
  await h.idle(lead);
  await h.call(lead, "lead", "ask", { kind: "question", text: "Round half up or down?", default: "half up" });
  await h.call(sup, "supervisor", "answer", { ask: "A1", text: "Half up." });
  await h.idle(lead);
  assert.deepEqual(sentBy({ clientMessageId: h.agents.get(lead)!.promptId }), ["brief"]);
  assert.deepEqual(sentBy({ clientMessageId: h.agents.get(lead)!.sentIds.at(-1) }), ["answer"]);
});

test("asks reach the level above, answers come back, and a silent Peer is nudged then reported", async () => {
  const h = harness();
  const turnEnded = h.endTurn;
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Asks", outcome: "x", acceptance: ["y"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.idle(lane.lead!);

  const asked = await h.call(lane.lead!, "lead", "ask", { kind: "question", text: "Round half up or down?", default: "half up" });
  assert.equal(asked.ok, true, asked.text);
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.at(-1)!, /ASK A1 \(question\)[\s\S]*half up/);
  assert.equal((await h.call(sup, "supervisor", "answer", { ask: "A1", text: "Half up." })).ok, true);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /ANSWER to your ask A1[\s\S]*Half up/);

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Quiet one", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;
  await new Promise((resolve) => setTimeout(resolve, 5));
  h.agents.get(task.peer!)!.status = "idle";
  await turnEnded(task.peer!, "I looked around.");
  await h.runtime.outbox.pump(task.peer!);
  assert.match(h.agents.get(task.peer!)!.sent.at(-1)!, /without calling done or ask/);
  h.runtime.outbox.turnEnded(task.peer!);
  await turnEnded(task.peer!, "Still looking.");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  h.agents.get(lane.lead!)!.status = "idle";
  h.runtime.outbox.turnEnded(lane.lead!);
  await h.runtime.outbox.pump(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /SILENT L1-T1[\s\S]*Still looking[\s\S]*Next: If its last words hand the work back without calling done, message it to call done; else message it, or cut it and start again\./, "accept needs a hand-back on record, so it is not offered");
});

test("a working Peer past the first page of agents is not read as gone", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  // A long-lived daemon: plenty of other agents, more recently active than the Peer about to start.
  for (let index = 0; index < 205; index++) h.add("sw2-supervisor-claude/claude-opus-5", h.root, `other-${index}`);

  await h.call(sup, "supervisor", "open_lane", { title: "Busy machine", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;
  assert.equal(h.agents.size > 200, true, "the seats this lane needs are past the first page");

  await h.tick(Date.now());
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "a seat the desk cannot see on one page is not a seat that is gone");
  await h.idle(lane.lead!);
  assert.doesNotMatch(h.agents.get(lane.lead!)!.sent.join("\n"), /was closed or archived/, "and its Lead is not told a working Peer was closed");
  assert.equal(task.peer !== undefined, true);
});

test("a call that runs longer than a seat can wait is answered by mail, and calling it again does not run it twice", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "sleep 0.4" });
  await h.call(sup, "supervisor", "open_lane", { title: "Slow", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  const request = { id: "r1", agent: lane.lead!, role: "lead", tool: "report", args: { summary: "ready to land", ready: true }, cwd: h.root, at: Date.now() };

  // The bridge waits five minutes but the gate thirty, so a retried call must not start a second gate.
  const [first, again] = await Promise.all([h.runtime.desk.answer(request, { within: 100 }), h.runtime.desk.answer({ ...request, id: "r2" }, { within: 100 })]);
  assert.match(first.text, /still working on report/);
  assert.match(again.text, /already running/);
  await Promise.all([...(h.runtime.desk as unknown as { running: Map<string, { reply: Promise<unknown> }> }).running.values()].map((entry) => entry.reply));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(readdirSync(join(h.project.state, "gates")).filter((name) => name.startsWith("L1-")).length, 1, "one gate ran, not two");
  await h.idle(lane.lead!);
  const told = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.equal(told.split("ANSWER to your report call").length - 1, 1, "and the answer came once, as mail");
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /REPORT L1/);
});

test("a hand-back whose gate outlasts the call is not read as a silent turn", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "sleep 0.4", gateOn: "task" });
  await h.call(sup, "supervisor", "open_lane", { title: "Slow", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.commit(lane.worktree!, "a.txt", "A\n");

  // Past what a call can wait, the Peer is told to end its turn; that turn must not read as one that never called done.
  h.beginTurn(peer);
  const reply = await h.runtime.desk.answer({ id: "d1", agent: peer, role: "peer", tool: "done", args: { outcome: "complete", summary: "done" }, cwd: h.root, at: Date.now() }, { within: 100 });
  assert.match(reply.text, /still working on done/);
  h.agents.get(peer)!.status = "idle";
  await h.endTurn(peer, "handed back, ending my turn as told");
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 0, "a call still being worked on is not silence");
  assert.doesNotMatch(h.agents.get(peer)!.sent.join("\n"), /without calling done or ask/);

  await Promise.all([...(h.runtime.desk as unknown as { running: Map<string, { reply: Promise<unknown> }> }).running.values()].map((entry) => entry.reply));
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "done");
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /Gate: sleep 0\.4 passed/);
});

test("a task stalled because its Peer is gone holds no copy, and an ask to a gone reader goes to whoever supervises now", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Gone", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  Object.assign(h.agents.get(peer)!, { archivedAt: new Date().toISOString(), status: "closed" });
  await h.tick(Date.now());
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");

  // Nobody writes in the copy any more, so the Lead must not be told to wait for a hand-back.
  const next = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "More", goal: "g", acceptance: ["b"], hints: ["b.txt"], outOfScope: ["the rest of the repository"] }] });
  assert.equal(next.ok, true, next.text);

  // A Lead's ask to a Supervisor that has since gone must reach the one who sits down afterwards.
  assert.equal((await h.call(lane.lead!, "lead", "ask", { kind: "question", text: "Keep the old endpoint?", default: "keep it" })).ok, true);
  Object.assign(h.agents.get(sup)!, { archivedAt: new Date().toISOString(), status: "closed" });
  const back = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup-2");
  await h.tick(Date.now() + 16 * 60_000);
  await h.idle(back);
  assert.match(h.agents.get(back)!.sent.join("\n"), /Keep the old endpoint\?/);
  assert.equal(Object.values(h.ledger().asks).find((ask) => ask.text.startsWith("Keep the old endpoint"))!.to, back);
});

test("an escalation with nobody supervising seated waits for one instead of being marked sent", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Asks", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  assert.equal((await h.call(peer, "peer", "ask", { question: "Round half up or down?", tried: "read the spec", bestGuess: "half up" })).ok, true);
  h.agents.get(lane.lead!)!.status = "idle";
  Object.assign(h.agents.get(sup)!, { archivedAt: new Date().toISOString(), status: "closed" });

  // With the only Supervisor archived there is nobody to escalate to, so it must not be marked escalated.
  const start = Date.now();
  for (const minutes of [16, 32, 48]) await h.tick(start + minutes * 60_000);
  const ask = Object.values(h.ledger().asks)[0]!;
  assert.equal(ask.escalated ?? false, false, "nobody received it, so it is not recorded as escalated");

  const back = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup-2");
  await h.tick(start + 64 * 60_000);
  await h.idle(back);
  assert.equal(Object.values(h.ledger().asks)[0]!.escalated, true);
  assert.match(h.agents.get(back)!.sent.join("\n"), /Round half up or down\?\n\nTried: read the spec\n\nTheir default: half up/, "and the Supervisor who came back is the one told, the Peer's best guess with it");
});

test("a stalled task still holds its working copy, and runs again once its Peer is heard from", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Quiet", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.agents.get(peer)!.status = "idle";
  for (const text of ["reading", "still reading"]) {
    h.runtime.outbox.turnEnded(peer);
    await new Promise((resolve) => setTimeout(resolve, 3));
    h.beginTurn(peer);
    await h.endTurn(peer, text);
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  assert.match(h.agents.get(peer)!.prompt ?? "", /Your task started from [0-9a-f]{40}/, "the brief names where the task began, which is BASE for its checks");

  // Its Peer is still seated in the lane's copy, so a stalled task still holds it.
  const second = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "More", goal: "g", acceptance: ["b"], hints: ["b.txt"], outOfScope: ["the rest of the repository"] }] });
  assert.match(second.text, /L1-T2 More: held: L1-T1 is still writing/);
  assert.equal(h.ledger().tasks["L1-T2"]!.peer, undefined);

  // Working again, it is running, so the patrol's gone-Peer and idle-lane checks see it.
  h.runtime.outbox.turnEnded(peer);
  await new Promise((resolve) => setTimeout(resolve, 3));
  h.beginTurn(peer);
  assert.equal((await h.call(peer, "peer", "ask", { question: "Which file first?", tried: "read both", bestGuess: "the one the test names" })).ok, true);
  await h.endTurn(peer, "asked");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running");
});

test("a Peer that asked is not stalled on its next quiet turn, and a repeated rework is not called sent", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Quiet", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;
  const peer = task.peer!;

  h.agents.get(peer)!.status = "idle";
  h.beginTurn(peer);
  await h.endTurn(peer, "still reading");
  await h.runtime.outbox.pump(peer);
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 1);
  assert.match(h.agents.get(peer)!.sent.at(-1)!, /without calling done or ask/);

  // Real turns are seconds apart, so the test waits for the desk's millisecond turn clock to move.
  h.runtime.outbox.turnEnded(peer);
  await new Promise((resolve) => setTimeout(resolve, 3));
  h.beginTurn(peer);
  assert.equal((await h.call(peer, "peer", "ask", { question: "Round half up or down?", tried: "read the spec", bestGuess: "half up" })).ok, true);
  await h.endTurn(peer, "asked and waiting");
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 0, "the count is of consecutive quiet turns, not a lifetime tally");

  h.runtime.outbox.turnEnded(peer);
  await new Promise((resolve) => setTimeout(resolve, 3));
  h.beginTurn(peer);
  await h.endTurn(peer, "applying it");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "a Peer that asked in between has not gone silent twice");
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 1);

  // The same instruction twice: letters are keyed by the event, so the second one really goes.
  const first = await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "Commit your work." });
  assert.equal(first.ok, true, first.text);
  const again = await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "Commit your work." });
  assert.equal(again.ok, true, "a Lead repeating itself is a second instruction, not a double post");
  h.runtime.outbox.turnEnded(peer);
  await h.runtime.outbox.pump(peer);
  const told = h.agents.get(peer)!.sent.join("\n");
  assert.equal(told.match(/Commit your work/g)?.length, 2, "both went; keyed by its words, the second was dropped and the Lead was told it was sent");
});

test("mail reaches a running seat inside its turn where its harness can take it there, and waits where it cannot", async () => {
  const h = harness();
  // omp takes mail only between turns.
  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ roles: { peer: { harness: "omp", model: "glm-5" } } }));
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Pricing", outcome: "discounts round correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Round", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  assert.equal(h.agents.get(lane.lead!)!.status, "running");
  assert.equal(h.agents.get(peer)!.status, "running");

  // Paseo turns a steer the provider cannot take yet into replacing the turn, so a new turn is left alone.
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    h.beginTurn(lane.lead!);
    h.beginTurn(peer);
    const early = await h.call(sup, "supervisor", "message", { to: "L1", text: "Is the premise right?" });
    assert.match(early.text, /Queued for the Lead of L1/);
    mock.timers.tick(2 * 60_000);
    await h.tick();
    assert.match(h.agents.get(lane.lead!)!.steered.join("\n"), /Is the premise right\?/, "the round delivers it once the turn has settled");

    const toLead = await h.call(sup, "supervisor", "message", { to: "L1", text: "Stop: the premise is wrong." });
    assert.match(toLead.text, /Delivered to the Lead of L1/);
    assert.match(h.agents.get(lane.lead!)!.steered.join("\n"), /the premise is wrong/, "the Lead's harness takes it mid-turn");

    const toPeer = await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: "Stop: the premise is wrong." });
    assert.match(toPeer.text, /Queued for the Peer on L1-T1/);
    assert.deepEqual(h.agents.get(peer)!.sent, [], "the Peer's harness cannot, and sending would replace its turn");
  } finally {
    mock.timers.reset();
  }
});

test("a Peer that is gone leaves its Lead only cut, since nothing it did can be accepted without a hand-back", async () => {
  const { h, lane, peer } = await laneWithPeer();
  Object.assign(h.agents.get(peer)!, { archivedAt: new Date().toISOString(), status: "closed" });
  await h.tick();
  await h.idle(lane.lead!);
  const told = h.heard(lane.lead!).join("\n");
  assert.match(told, /its agent was closed or archived[\s\S]*Next: Nothing restarts it, and without a hand-back it cannot be accepted: cut it and start it again, naming its branch in the new brief if what it committed is worth carrying on\./);
});
