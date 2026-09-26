import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { configFile } from "../../server/desk/project/project.ts";
import { contracts } from "../../shared/rpc.ts";
import { settle } from "./fake-timeline.ts";
import { harness, laneWithPeer } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

const packet = (extra: Record<string, unknown> = {}) => ({
  question: "Delete old invoices, or keep them archived?",
  why: "It decides whether customers' records can come back.",
  options: [
    { label: "Delete", effect: "Invoices older than 7 years are gone for good." },
    { label: "Archive", effect: "They move to cold storage and can be restored." },
  ],
  recommend: "Archive",
  reason: "Nothing is lost.",
  ifSilent: "The lane archives them.",
  class: "reversible",
  ...extra,
});

/** The Flow tab as the panel reads it, `open` naming the lanes it shows the tasks of. */
async function flowOf(h: Harness, open: string[] = [], since?: string) {
  const read = await h.rpc(contracts.flow, { project: h.project.slug, open, since });
  assert.ok(!("error" in read));
  return read;
}

async function drawn(h: Harness, open: string[] = []) {
  const read = await flowOf(h, open);
  assert.ok("lanes" in read);
  return read;
}

test("a question waits in the Human's queue, and their answer, on the panel or in the Supervisor's chat, goes on record and to whoever asked", async () => {
  const { h, sup } = await laneWithPeer();
  const ask = (extra: Record<string, unknown>) => h.call(sup, "supervisor", "ask_human", packet(extra));
  const record = (question: string, choice: string, quote: string) =>
    h.call(sup, "supervisor", "record_human_answer", { question, choice, quote });
  const answer = (question: string, choice: string, note = "") =>
    h.rpc(contracts.questionAnswer, { project: h.project.slug, question, choice, note });
  assert.match(
    (await ask({ recommend: "Shred" })).text,
    /recommend names none of the options: give one of Delete, Archive\./,
  );
  const cancel = [
    { label: "Delete", effect: "x" },
    { label: "cancel", effect: "y" },
  ];
  assert.match((await ask({ options: cancel, recommend: "Delete" })).text, /none called decline or cancel/);
  assert.match((await ask({ options: cancel.slice(0, 1), recommend: "Delete" })).text, /options takes at least 2/);

  assert.match(
    (await ask({ lane: "L1", class: "irreversible" })).text,
    /^Asked the Human as H1; it waits in their question queue\. Nothing it decides goes ahead until they answer\. Lane L1 is on hold for it\./,
  );
  const why = "it waits for the Human's answer to H1: Delete old invoices, or keep them archived?";
  assert.equal(h.ledger().lanes.L1!.onHold?.reason, why);
  assert.match(
    (await h.call(sup, "supervisor", "status", {})).text,
    /## Questions for the Human\n\n- H1 \(irreversible, L1\), open 0 min: Delete old invoices, or keep them archived\? Recommended: Archive\. While silent: The lane archives them/,
  );
  const flow = await drawn(h);
  assert.deepEqual(
    flow.questions.map((question) => [
      question.id,
      question.class,
      question.lane,
      question.recommend,
      question.options.map((option) => option.label),
    ]),
    [["H1", "irreversible", "L1", "Archive", ["Delete", "Archive"]]],
  );
  assert.equal(flow.lanes[0]!.onHold?.reason, why);

  assert.match(
    (await record("H1", "Delete", "delete them all")).text,
    /The Human's own words "delete them all" are not in this chat/,
  );
  h.timelineOf(sup).add({ type: "user_message", text: "Hmm.  Archive them,\nplease.", clientMessageId: "app-1" });
  h.timelineOf(sup).add({ type: "user_message", text: "SEEN L1-T1 hand back", clientMessageId: "sw2-handback-1" });
  h.timelineOf(sup).add({ type: "user_message", text: "LANDED L1: delete the old invoices" });
  assert.match((await record("H1", "Delete", "seen l1-t1 hand back")).text, /are not in this chat/);
  assert.match((await record("H1", "Delete", "delete the old invoices")).text, /are not in this chat/);

  assert.deepEqual(await answer("H1", "Keep"), {
    error: "Keep is none of H1's options: Delete, Archive, or decline or cancel.",
  });
  assert.deepEqual(await answer("H1", "cancel"), {
    error: "Only the Supervisor cancels a question; choose one of its options, or decline it.",
  });
  assert.deepEqual(await answer("h1", "Archive", "and keep a list of them"), {
    answered: "H1 is answered: Archive. The Supervisor has it.",
  });
  const answered = h.ledger().questions.H1!;
  assert.deepEqual(
    [answered.status, answered.answer?.by, answered.answer?.text],
    ["answered", "panel", "and keep a list of them"],
  );
  assert.match(
    h.heard(sup).join("\n"),
    /HUMAN ANSWERED H1 \(Delete old invoices, or keep them archived\?\), on the panel: Archive\.\n\nTheir note, their own words:\nand keep a list of them\n\nLane L1 is still on hold for it\.\n\nNext: Carry their choice into the lane, and write it into CONTEXT\.md if it settles the concept; then resume_lane L1\./,
  );
  assert.match((await record("H1", "decline", "archive them")).text, /H1 is already answered\./);

  assert.match((await ask({ lane: "L1", class: "irreversible" })).text, /Its lane was not put on hold: /);
  assert.equal(
    (await record("h2", "Archive", "archive them, please!")).text,
    "H2 is answered: Archive. Lane L1 is still on hold for it: resume_lane it once the answer is carried into the lane.",
  );
  assert.equal(h.ledger().questions.H2!.answer?.by, "chat");
  await ask({});
  assert.deepEqual(await answer("H3", "decline"), { answered: "H3 is declined. The Supervisor has it." });
  assert.match(
    h.heard(sup).join("\n"),
    /HUMAN ANSWERED H3 \([^)]*\), on the panel: they declined to decide it\.\n\nNext: The call is yours now: decide it and carry that where it applies\./,
  );
  assert.deepEqual((await drawn(h)).questions, []);
});

test("Orders reads back the Human's standing orders and the project's concept, and says when the orders cannot be read", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const orders = () => h.rpc(contracts.orders, { project: h.project.slug });
  await h.call(sup, "supervisor", "set_project", { askFirst: ["src/auth"], laneHome: "isolate" });
  writeFileSync(join(h.project.state, "CONTEXT.md"), "# Invoices\n\nAn invoice is never edited.\n");
  const read = await orders();
  assert.ok("askFirst" in read);
  assert.deepEqual(
    [read.fault, read.askFirst, read.laneHome, read.ownRules, read.riskRules.length],
    [null, ["src/auth"], "isolate", false, 1],
  );
  assert.match(read.riskRules[0]!.reviewQuestion, /second time/);
  assert.deepEqual([read.concept?.text, read.concept?.more], ["# Invoices\n\nAn invoice is never edited.\n", false]);
  await h.call(sup, "supervisor", "set_project", { riskRules: [] });
  const own = await orders();
  assert.ok("askFirst" in own && own.ownRules && own.riskRules.length === 0);
  writeFileSync(configFile(h.project.state), "{ not json");
  const broken = await orders();
  assert.ok("askFirst" in broken);
  assert.match(broken.fault ?? "", /project\.json is there but could not be read/);
  assert.deepEqual(await h.rpc(contracts.orders, { project: "nope" }), {
    error: "No project named nope has been seen on this machine.",
  });
});

test("the Report tells the last day from the record: what needs the Human, what went ahead, what landed, and what could not be undone", async () => {
  const { h, sup, timeline } = await laneWithPeer();
  await h.call(sup, "supervisor", "ask_human", packet({ lane: "L1", class: "irreversible" }));
  await h.call(sup, "supervisor", "ask_human", packet({ question: "Dates as ISO?" }));
  await h.call(sup, "supervisor", "ask_human", packet({ question: "Rename the product?", class: "irreversible" }));
  timeline.beat("turn_started", "t1");
  const push = { type: "shell", command: "git push --force origin main" };
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "running", detail: push }, "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const report = await h.rpc(contracts.report, { project: h.project.slug });
  assert.ok("needs" in report);
  assert.deepEqual(
    report.needs.map((item) => [item.title, item.detail]),
    [
      ["H1 · Delete old invoices, or keep them archived?", "irreversible · L1"],
      ["H3 · Rename the product?", "irreversible"],
    ],
  );
  assert.deepEqual(
    report.ahead.map((item) => [item.title, item.detail]),
    [["H2 · Dates as ISO?", "reversible · went ahead on Archive"]],
  );
  assert.deepEqual(
    report.beyond.map((item) => [item.title, item.detail]),
    [["I1 · git push --force origin main", "the Peer on L1-T1 (Clean build) · not marked"]],
  );
  assert.deepEqual(
    report.numbers.map((row) => [row.title, row.value]),
    [
      ["Questions today", "3 of 3"],
      ["Landings", "0 landed"],
      ["Incidents", "1"],
    ],
  );

  const landing = harness();
  const boss = landing.add("sw2-supervisor-claude/claude-opus-5", landing.root, "sup");
  await landing.call(boss, "supervisor", "set_project", { gate: "true" });
  await landing.call(boss, "supervisor", "open_lane", {
    title: "Cart",
    outcome: "a cart",
    acceptance: ["a"],
    outOfScope: ["the rest"],
  });
  landing.commit(landing.ledger().lanes.L1!.worktree!, "a.txt", "cart\n");
  assert.equal((await landing.call(boss, "supervisor", "land_lane", { lane: "L1" })).ok, true);
  const landed = await landing.rpc(contracts.report, { project: landing.project.slug });
  assert.ok("landed" in landed);
  assert.deepEqual(
    landed.landed.map((item) => [item.title, item.detail]),
    [["L1 Cart", "on main"]],
  );
});

test("the Flow tab draws the machine as the ledger and Paseo have it, and an unchanged poll costs nothing", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const fresh = await drawn(h);
  assert.deepEqual([fresh.lanes, fresh.asks, fresh.questions, fresh.moreLanes], [[], [], [], 0]);
  const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", ...scope });
  const lead = h.ledger().lanes.L1!.lead!;
  const add = (key: string, extra: Record<string, unknown>) =>
    h.call(lead, "lead", "add_tasks", { tasks: [{ key, title: key, goal: "g", ...scope, ...extra }] });
  await add("One", { hints: ["a.txt"] });
  await add("Two", { holds: ["c.txt"], parallel: true });
  await add("Three", { hints: ["b.txt"], after: ["L1-T2"] });
  await add("Four", { hints: ["b.txt"] });
  const [one, two] = ["L1-T1", "L1-T2"].map((id) => h.ledger().tasks[id]!);
  h.agents
    .get(one!.peer!)!
    .pending.push({ id: "p1", kind: "tool", name: "Write", title: "Write outside the working copy" });

  const shut = await drawn(h);
  const cart = shut.lanes[0]!;
  assert.deepEqual([cart.tasks, cart.taskCount, cart.running, cart.open, cart.copy], [[], 4, 2, false, null]);
  assert.deepEqual([cart.lead?.role, cart.lead?.waiting], ["lead", []]);
  assert.deepEqual(await flowOf(h, [], shut.revision), { unchanged: true, revision: shut.revision });
  h.agents.get(two!.peer!)!.archivedAt = new Date().toISOString();
  const opened = await drawn(h, ["L1"]);
  assert.notEqual(opened.revision, shut.revision);
  const tasks = Object.fromEntries(opened.lanes[0]!.tasks.map((task) => [task.id, task]));
  assert.deepEqual(
    ["L1-T1", "L1-T2"].map((id) => [tasks[id]!.mode, tasks[id]!.copy, tasks[id]!.after, tasks[id]!.held]),
    [
      ["lane", null, [], null],
      ["parallel", "S0", [], null],
    ],
  );
  assert.deepEqual(tasks["L1-T3"]!.after, ["L1-T2"]);
  assert.equal(
    tasks["L1-T4"]!.held,
    "L1-T1 is still writing in the lane's working copy, and it holds one writer at a time. It starts by itself once that clears; amend it, or cut it to drop it.",
  );
  assert.deepEqual(tasks["L1-T1"]!.peer?.waiting, ["Write outside the working copy"]);
  assert.equal(tasks["L1-T2"]!.peer?.status, "gone");
  await h.call(lead, "lead", "start_review", { focus: "the cart as a whole" });
  const review = (await drawn(h, ["L1"])).lanes[0]!.tasks.find((task) => task.kind === "review");
  assert.deepEqual([review?.id, review?.mode, review?.after], ["L1-R1", "lane", []]);

  await h.call(lead, "lead", "ask", {
    kind: "question",
    text: "Which rounding do we use?\nThe spec says nothing.",
    default: "half up",
  });
  assert.deepEqual(
    (await drawn(h)).asks.map((ask) => [ask.id, ask.text, ask.minutes]),
    [["A1", "Which rounding do we use?", 0]],
  );
  await h.call(sup, "supervisor", "answer", { ask: "A1", text: "Half up." });
  assert.deepEqual((await drawn(h)).asks, []);

  const apart = { outcome: "x", ...scope, isolate: true };
  await h.call(sup, "supervisor", "open_lane", { title: "Apart", ...apart });
  await h.call(sup, "supervisor", "open_lane", { title: "After", ...apart, after: ["L2"] });
  assert.equal((await drawn(h)).lanes.find((lane) => lane.id === "L2")!.copy, "S1");
  await h.call(sup, "supervisor", "drop_lane", { lane: "L2", reason: "not now" });
  const after = (await drawn(h)).lanes.find((lane) => lane.id === "L3")!;
  assert.deepEqual([after.status, after.after, after.lead], ["waiting", ["L2"], null]);
  assert.match(after.held ?? "", /Lane L2 closed without landing/);

  await h.call(sup, "supervisor", "open_lane", { title: "Kept", ...apart });
  const kept = h.ledger().lanes.L4!;
  await h.call(kept.lead!, "lead", "add_tasks", {
    tasks: [{ key: "k", title: "Beside", goal: "g", ...scope, holds: ["k.txt"], parallel: true }],
  });
  const beside = h.ledger().tasks["L4-T1"]!;
  h.commit(beside.worktree!, "k.txt", "k\n");
  await h.call(beside.peer!, "peer", "done", { outcome: "complete", summary: "k" });
  h.agents.get(beside.peer!)!.status = "idle";
  await h.call(kept.lead!, "lead", "accept", { task: "L4-T1" });
  await h.runtime.desk.settled(h.project);
  const keptOf = async () => (await drawn(h)).lanes.find((lane) => lane.id === "L4")?.kept.map((seat) => seat.task);
  assert.deepEqual(await keptOf(), ["L4-T1"]);
  await h.call(kept.lead!, "lead", "release", { task: "L4-T1" });
  assert.deepEqual(await keptOf(), []);
  h.agents.get(kept.lead!)!.status = "idle";
  await h.call(sup, "supervisor", "land_lane", { lane: "L4" });
  const closed = (await drawn(h)).lanes.find((lane) => lane.id === "L4")!;
  assert.deepEqual([closed.status, closed.landed, closed.copy], ["closed", true, kept.slot]);
  await h.call(sup, "supervisor", "release", { lane: "L4" });
  assert.equal(
    (await drawn(h)).lanes.find((lane) => lane.id === "L4"),
    undefined,
  );

  h.agents.get(sup)!.archivedAt = new Date().toISOString();
  const next = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup-2");
  await h.call(next, "supervisor", "status", {});
  assert.deepEqual(
    (await drawn(h)).supervisors.map((seat) => [seat.id, seat.status]),
    [[next, "idle"]],
  );
  h.agents.get(next)!.archivedAt = new Date().toISOString();
  assert.deepEqual(
    (await drawn(h)).supervisors.map((seat) => [seat.id, seat.status]),
    [[next, "gone"]],
  );
});
