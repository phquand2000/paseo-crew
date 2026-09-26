import assert from "node:assert/strict";
import { test } from "node:test";
import { type Pending, harness, laneWithPeer } from "./harness.ts";

test("a task cannot be told to open a skill its Peer does not have", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Skilled", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  const scope = { goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] };

  // Nothing in a Lead's context lists the Peer's skills, so a guessed one must be refused.
  const guessed = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Guessed", ...scope, skills: ["tdd"] }] });
  assert.equal(guessed.ok, false);
  assert.match(guessed.text, /no skill called tdd/);
  assert.match(guessed.text, /They have: /, "and the refusal is where the Lead finds out what there is");

  const real = guessed.text.split("They have: ")[1]!.replace(/\.$/, "").split(", ")[0]!;
  const named = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Named", ...scope, skills: [real] }] });
  assert.equal(named.ok, true, named.text);
  const started = Object.values(h.ledger().tasks).find((task) => task.title === "Named")!;
  assert.match(h.agents.get(started.peer!)!.prompt!, new RegExp(`Skills to open: ${real}`));
  assert.equal(Object.values(h.ledger().tasks).some((task) => task.title === "Guessed"), false, "a refused task does not take an id either");
});

test("a task whose honest answer is that nothing needed changing can be accepted, not only cut", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Audit", outcome: "the parser is checked", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Check the parser", goal: "find out whether it drops input", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;

  // The Peer investigates, finds the code already correct, and commits nothing. That is a real outcome.
  assert.equal((await h.call(peer, "peer", "done", { outcome: "complete", summary: "nothing needed changing: the parser already handles it" })).ok, true);
  h.agents.get(peer)!.status = "idle";
  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(accepted.ok, true, accepted.text);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged", "the Lead judges the hand-back; the desk does not decide that no diff means no work");

  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /changed no files/, "the letter says plainly that nothing moved");
});

test("a seat reaches only the tools its own role holds, whatever it asks for", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Work", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Edit", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;

  // The tool exists on the desk, and this seat's role is not given it.
  const reach = await h.call(peer, "peer", "open_lane", { title: "Mine", outcome: "x", acceptance: ["y"], outOfScope: ["z"] });
  assert.equal(reach.ok, false);
  assert.match(reach.text, /Unknown tool open_lane/);
  assert.equal(Object.keys(h.ledger().lanes).length, 1, "nothing was opened");

  // And a seat cannot borrow another role's name to get at them either.
  const borrowed = await h.call(peer, "lead", "add_tasks", { tasks: [{ key: "t", title: "Mine", goal: "g", acceptance: ["a"], hints: ["b.txt"], outOfScope: ["z"] }] });
  assert.equal(borrowed.ok, false);
  assert.match(borrowed.text, /lead tools are not available to it/);
});

test("two supervising seats hold one project, and each lane's mail goes to the seat that opened it", async () => {
  const h = harness();
  const architecture = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "architecture");
  const safety = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "safety");
  const scope = { outOfScope: ["anything else"] };

  await h.call(architecture, "supervisor", "open_lane", { title: "Schema", outcome: "the schema moves", acceptance: ["a"], ...scope });
  // The hole found mid-lane gets its own Lead and its own copy, rather than the first lane widening to swallow it.
  await h.call(safety, "supervisor", "open_lane", { title: "Permissions", outcome: "writes are checked", acceptance: ["a"], isolate: true, detourOf: "L1", ...scope });
  const lanes = h.ledger().lanes;
  assert.equal(lanes.L1!.opener, architecture);
  assert.equal(lanes.L2!.opener, safety);
  assert.equal(lanes.L2!.detourOf, "L1");
  assert.match(h.agents.get(lanes.L2!.lead!)!.prompt ?? "", /clears the way for L1/, "the detour's Lead is told what it is unblocking");

  await h.call(lanes.L1!.lead!, "lead", "report", { summary: "schema done", ready: false });
  await h.call(lanes.L2!.lead!, "lead", "report", { summary: "permissions done", ready: false });
  await h.idle(architecture);
  await h.idle(safety);
  assert.match(h.agents.get(architecture)!.sent.join("\n"), /schema done/);
  assert.doesNotMatch(h.agents.get(architecture)!.sent.join("\n"), /permissions done/, "one supervising seat does not read another's lane");
  assert.match(h.agents.get(safety)!.sent.join("\n"), /permissions done/);
});

test("reaching a Peer directly tells its Lead what reached it, and is refused when there is no Lead to tell", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Pricing", outcome: "discounts round correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Round", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] }] });
  const task = h.ledger().tasks["L1-T1"]!;

  const reached = await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "Use banker's rounding, not half-up." });
  assert.equal(reached.ok, true, reached.text);
  await h.idle(task.peer!);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(task.peer!)!.sent.join("\n"), /banker's rounding/);

  // The Lead is not merely copied: it is given back the five things it needs to hold the room's state.
  const toLead = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(toLead, /RECONCILE L1/);
  assert.match(toLead, /banker's rounding/, "what reached the Peer");
  assert.match(toLead, /Current intent: discounts round correctly/);
  assert.match(toLead, /Ownership: L1-T1 .* is still owned by/);
  assert.match(toLead, /Topology: unchanged/);
  assert.match(toLead, /Integration and acceptance: unchanged/);

  // The same instruction again is a second instruction, not a repeat to drop by its words.
  await h.idle(task.peer!);
  await h.idle(lane.lead!);
  assert.equal((await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "Use banker's rounding, not half-up." })).ok, true);
  await h.idle(task.peer!);
  await h.idle(lane.lead!);
  assert.equal(h.agents.get(task.peer!)!.sent.join("\n").split("banker's rounding").length - 1, 2, "both reached the Peer");
  assert.equal(h.agents.get(lane.lead!)!.sent.join("\n").split("RECONCILE L1").length - 1, 2, "and the Lead was told both times");

  // With no Lead to reconcile to, the intervention is refused rather than run behind its back.
  Object.assign(h.agents.get(lane.lead!)!, { archivedAt: new Date().toISOString(), status: "closed" });
  const orphaned = await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "One more thing." });
  assert.equal(orphaned.ok, false);
  assert.match(orphaned.text, /no running Lead/);

  // A task already cut has no Peer left to steer.
  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" });
  const cut = await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "One more thing." });
  assert.equal(cut.ok, false);
  assert.match(cut.text, /L1-T1 is cut/);
});

test("an ask answered by the owner over a Lead's head is told to that Lead, not run behind its back", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Columns", outcome: "the column goes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Drop it", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;

  // Unanswered asks escalate to the owner, so the owner answering one is the design.
  const asked = await h.call(task.peer!, "peer", "ask", { question: "Drop the column or keep it nullable?", tried: "read the migration", bestGuess: "keep it nullable" });
  assert.equal(asked.ok, true, asked.text);
  const ask = Object.values(h.ledger().asks)[0]!;
  assert.equal(ask.to, lane.lead, "an ask goes upward, to the Lead");

  const answered = await h.call(sup, "supervisor", "answer", { ask: ask.id, text: "Drop it and migrate." });
  assert.equal(answered.ok, true, answered.text);
  await h.idle(task.peer!);
  assert.match(h.agents.get(task.peer!)!.sent.join("\n"), /Drop it and migrate/, "the Peer gets its answer");

  await h.idle(lane.lead!);
  const toLead = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(toLead, new RegExp(`ANSWERED FOR YOU: ${ask.id}`), "the Lead cannot hold the room's state on an answer it never saw");
  assert.match(toLead, /Drop it and migrate/);
  assert.match(toLead, /accepting it is still yours to judge/);
});

test("a task goes to a role that writes, and a review to one that reads, and neither stands in for the other", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;

  // The preset's Reviewer holds `work` for routing but is denied every write, so it is no second kind of Peer.
  const readOnly = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add four", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"], role: "reviewer" }] });
  assert.equal(readOnly.ok, false, "a role that only reads cannot be given a task to write");
  assert.match(readOnly.text, /no reviewer that can take a task/i);
  assert.match(readOnly.text, /peer/, "and the refusal names who can, rather than recommending the one that cannot");
  assert.deepEqual(Object.keys(h.ledger().tasks), [], "and nothing was started or recorded");

  const wrongLens = await h.call(lane.lead!, "lead", "start_review", { focus: "Is the rounding right?", role: "peer" });
  assert.equal(wrongLens.ok, false);
  assert.match(wrongLens.text, /no peer that can review/i);
  assert.match(wrongLens.text, /reviewer/, "the refusal names what there is to choose from");

  const byDefault = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add five", goal: "g", acceptance: ["a"], hints: ["b.txt"], outOfScope: ["the rest"] }] });
  assert.equal(byDefault.ok, true, byDefault.text);
  const seated = Object.values(h.ledger().tasks).find((task) => task.title === "Add five")!;
  assert.match(h.agents.get(seated.peer!)!.provider, /peer/, "left out, it is the preset's own default");
});

test("a question that would stop a seat's turn is refused with where to ask instead, while leave to run something waits for the Human", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Colours", outcome: "the button is coloured", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Colour", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  // A Watcher has no ask: told to use one, it was pointed at a tool it cannot call.
  const watcher = h.add("sw2-watcher-claude/claude-opus-5", h.root, "watcher");
  const question: Pending = { id: "permission-1", kind: "question", name: "AskUserQuestion", title: "Which colour should the button be?", input: { questions: [{ question: "Which colour should the button be?", options: [{ label: "Blue" }] }] } };
  const ways = [
    [peer, /ask it with ask, then end your turn/],
    [sup, /put it to the Human with ask_human, or ask them in your reply and end your turn/],
    [watcher, /^A question that stops your turn is not taken here: answer from what you have, saying what you could not settle, then end your turn\.$/],
  ] as const;
  for (const [seat, text] of ways) {
    h.agents.get(seat)!.pending.push(question);
    await h.permission(seat, question);
    assert.equal(h.agents.get(seat)!.answered.at(-1)!.response.behavior, "deny");
    assert.match(String((h.agents.get(seat)!.answered.at(-1)!.response as { message?: string }).message), text);
  }
  await h.idle(lane.lead!);
  assert.doesNotMatch(h.agents.get(lane.lead!)!.sent.join("\n"), /WAITING FOR PERMISSION/, "nobody is asked to answer a question the seat was told to put another way");

  // Leave to run something is the Human's to give; the desk answers nothing on anyone's behalf.
  const command: Pending = { id: "permission-2", kind: "tool", name: "Bash", title: "rm -rf build" };
  h.agents.get(peer)!.pending.push(command);
  await h.permission(peer, command);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /WAITING FOR PERMISSION[^]*Bash: rm -rf build\n\nOnly the Human can answer this[^]*\n\nNext: If it holds the lane up, ask, so the owner can tell the Human\./);
  const held = await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: "Go ahead." });
  assert.match(held.text, /stopped on a permission only the Human can give/);
  assert.equal(h.agents.get(peer)!.answered.length, 1, "the command is left for the Human");
  assert.equal(h.runtime.outbox.pending(peer).length, 1, "and the message waits for it");
});

test("every call is held to the schema the seat was shown, and told what it takes", async () => {
  // An unchecking harness sent prose, misnamed fields and lists, and the desk wrote "No summary given." into hand-backs.
  const { h, lane, peer } = await laneWithPeer();
  const prose = await h.call(peer, "peer", "done", { outcome: "I finished the module and tests pass", summary: "built it" });
  assert.equal(prose.ok, false, prose.text);
  assert.match(prose.text, /outcome must be one of complete, partial, blocked/);
  const misnamed = await h.call(peer, "peer", "done", { outcome: "complete", summary: "built it", commits: "abc", checks: ["npm test"] });
  assert.equal(misnamed.ok, false);
  assert.match(misnamed.text, /no field commits/);
  assert.match(misnamed.text, /checks must be text/);
  assert.match(misnamed.text, /It takes outcome, summary, and optionally checks, leftUndone, discovered/);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "nothing was handed back");
  const report = await h.call(lane.lead!, "lead", "report", { summary: "done", carries: "a note" });
  assert.equal(report.ok, false);
  assert.match(report.text, /needs ready/);
  const blank = await h.call(peer, "peer", "done", { outcome: "complete", summary: "  " });
  assert.match(blank.text, /needs summary/, "a required text has to say something");
  assert.match((await h.call(lane.lead!, "lead", "ask", { kind: "question", text: "Which one?" })).text, /needs default \(What you do meanwhile/, "a Lead that asks says what it does meanwhile");
  assert.match((await h.call(peer, "peer", "ask", { question: "Which one?" })).text, /needs bestGuess \(Your best answer to it/, "a Peer that asks says its best guess");
});
