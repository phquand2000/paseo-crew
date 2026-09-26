import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { contracts } from "../../shared/rpc.ts";
import { emptyLedger, saveLedger } from "../../server/desk/store/ledger.ts";
import { configFile } from "../../server/desk/project.ts";
import { settle } from "./fake-timeline.ts";
import { harness, laneWithPeer } from "./harness.ts";

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

test("a question waits on Flow, and the Human's choice there goes on the record and to whoever asked", async () => {
  const { h, sup } = await laneWithPeer();
  await h.call(sup, "supervisor", "ask_human", packet({ lane: "L1", class: "irreversible" }));
  const flow = await h.rpc(contracts.flow, { project: h.project.slug });
  assert.ok("questions" in flow);
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
  assert.equal(
    flow.lanes[0]!.onHold?.reason,
    "it waits for the Human's answer to H1: Delete old invoices, or keep them archived?",
  );

  const answer = (question: string, choice: string, note = "") =>
    h.rpc(contracts.questionAnswer, { project: h.project.slug, question, choice, note });
  assert.deepEqual(await answer("H1", "Keep"), {
    error: "Keep is none of H1's options: Delete, Archive, or decline or cancel.",
  });
  assert.deepEqual(await answer("H1", "cancel"), {
    error: "Only the Supervisor cancels a question; choose one of its options, or decline it.",
  });
  assert.deepEqual(await answer("h1", "Archive", "and keep a list of them"), {
    answered: "H1 is answered: Archive. The Supervisor has it.",
  });
  assert.deepEqual(
    [h.ledger().questions.H1!.status, h.ledger().questions.H1!.answer?.by, h.ledger().questions.H1!.answer?.text],
    ["answered", "panel", "and keep a list of them"],
  );
  assert.match(
    h.heard(sup).join("\n"),
    /HUMAN ANSWERED H1 \(Delete old invoices, or keep them archived\?\), on the panel: Archive\.\n\nTheir note, their own words:\nand keep a list of them\n\nLane L1 is still on hold for it\.\n\nNext: Carry their choice into the lane, and write it into CONTEXT\.md if it settles the concept; then resume_lane L1\./,
  );
  assert.deepEqual(await answer("H1", "Delete"), { error: "H1 is already answered." });

  await h.call(sup, "supervisor", "ask_human", packet());
  assert.deepEqual(await answer("H2", "decline"), { answered: "H2 is declined. The Supervisor has it." });
  assert.match(
    h.heard(sup).join("\n"),
    /HUMAN ANSWERED H2 \([^)]*\), on the panel: they declined to decide it\.\n\nNext: The call is yours now: decide it and carry that where it applies\./,
  );
  const after = await h.rpc(contracts.flow, { project: h.project.slug });
  assert.ok("questions" in after && after.questions.length === 0, "nothing is left for them to answer");
});

test("Orders reads back the Human's standing orders and the project's concept, and says when the orders cannot be read", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { askFirst: ["src/auth"], laneHome: "isolate" });
  writeFileSync(join(h.project.state, "CONTEXT.md"), "# Invoices\n\nAn invoice is never edited.\n");
  const orders = await h.rpc(contracts.orders, { project: h.project.slug });
  assert.ok("askFirst" in orders);
  assert.deepEqual(
    [orders.fault, orders.askFirst, orders.laneHome, orders.ownRules, orders.riskRules.length],
    [null, ["src/auth"], "isolate", false, 1],
  );
  assert.match(orders.riskRules[0]!.reviewQuestion, /second time/);
  assert.deepEqual(
    [orders.concept?.text, orders.concept?.more],
    ["# Invoices\n\nAn invoice is never edited.\n", false],
  );

  await h.call(sup, "supervisor", "set_project", { riskRules: [] });
  const own = await h.rpc(contracts.orders, { project: h.project.slug });
  assert.ok(
    "askFirst" in own && own.ownRules && own.riskRules.length === 0,
    "an empty list of its own is the project's answer, not the kit's",
  );
  writeFileSync(configFile(h.project.state), "{ not json");
  const broken = await h.rpc(contracts.orders, { project: h.project.slug });
  assert.ok("askFirst" in broken);
  assert.match(broken.fault ?? "", /project\.json is there but could not be read/);
  assert.deepEqual(await h.rpc(contracts.orders, { project: "nope" }), {
    error: "No project named nope has been seen on this machine.",
  });
});

test("the Report puts an irreversible question about no lane under what needs the Human, and counts the day's questions across every project", async () => {
  const { h, sup } = await laneWithPeer();
  await h.call(sup, "supervisor", "ask_human", packet({ question: "Rename the product?", class: "irreversible" }));
  const elsewhere = join(dirname(h.project.state), "other-3f9a1c");
  const theirs = emptyLedger();
  theirs.questions.H1 = {
    id: "H1",
    from: "sup-2",
    question: "?",
    why: "",
    options: [],
    recommend: "",
    reason: "",
    ifSilent: "",
    class: "reversible",
    status: "answered",
    openedAt: Date.now(),
  };
  saveLedger(elsewhere, theirs);
  const report = await h.rpc(contracts.report, { project: h.project.slug });
  assert.ok("needs" in report);
  assert.deepEqual(
    report.needs.map((item) => item.title),
    ["H1 · Rename the product?"],
    "nothing of it goes ahead while the Human is silent",
  );
  assert.deepEqual(report.ahead, []);
  assert.deepEqual(
    report.numbers[0],
    { title: "Questions today", value: "2 of 3", detail: "across every project" },
    "the limit is the Human's, for every project at once",
  );
});

test("the Report tells the last day from the record: what needs the Human, what went ahead, what landed, and what could not be undone", async () => {
  const { h, sup, timeline } = await laneWithPeer();
  await h.call(sup, "supervisor", "ask_human", packet({ lane: "L1", class: "irreversible" }));
  await h.call(sup, "supervisor", "ask_human", packet({ question: "Dates as ISO?" }));
  timeline.beat("turn_started", "t1");
  timeline.add(
    {
      type: "tool_call",
      callId: "c1",
      name: "Bash",
      status: "running",
      detail: { type: "shell", command: "git push --force origin main" },
    },
    "t1",
  );
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const report = await h.rpc(contracts.report, { project: h.project.slug });
  assert.ok("needs" in report);
  assert.deepEqual(
    report.needs.map((item) => [item.title, item.detail]),
    [["H1 · Delete old invoices, or keep them archived?", "irreversible · L1"]],
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
      ["Questions today", "2 of 3"],
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
  const lane = landing.ledger().lanes.L1!;
  landing.commit(lane.worktree!, "a.txt", "cart\n");
  assert.equal((await landing.call(boss, "supervisor", "land_lane", { lane: "L1" })).ok, true);
  const landed = await landing.rpc(contracts.report, { project: landing.project.slug });
  assert.ok("landed" in landed);
  assert.deepEqual(
    landed.landed.map((item) => [item.title, item.detail]),
    [["L1 Cart", "on main"]],
  );
});
