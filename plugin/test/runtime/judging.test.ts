import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import type { SensorSpec } from "../../server/catalog/kit.ts";
import { stateRoot } from "../../server/core/paths.ts";
import type { Answer, Judge, Question } from "../../server/core/ports.ts";
import { contracts } from "../../shared/rpc.ts";
import { reported } from "../console.ts";
import { type FakeTimeline, settle } from "./fake-timeline.ts";
import { harness, laneWithPeer } from "./harness.ts";
import { noticesOf } from "./noticed.ts";

const KEY = "a-key-for-tests-only";

type Asked = { key: string; state: Record<string, unknown>; questions: Record<string, Question> };

/** A sensor answering each noul by its check's name in `nouls` and every choice with `picks`, or failing once told to; and what it was asked, with which key. */
function sensor(nouls: Record<string, number>, picks: Answer = { choice: "claims_code_bug", confidence: 0.9 }) {
  const asked: Asked[] = [];
  let failing: Error | undefined;
  const make = (_spec: SensorSpec, key: string): Judge => ({
    async ask(state, questions) {
      asked.push({ key, state, questions });
      if (failing) throw failing;
      const answers = Object.fromEntries(
        Object.entries(questions).map(([name, question]): [string, Answer] => [
          name,
          question.type === "noul" ? { noul: nouls[name.split("__")[0]!] ?? 0.5 } : picks,
        ]),
      );
      return { answers, model: "vendor/model-1-20260917", tokens: 321 };
    },
  });
  const of = (check: string) =>
    asked.filter((entry) => Object.keys(entry.questions).some((name) => name.split("__")[0] === check));
  return { asked, make, of, fail: (error?: Error) => void (failing = error) };
}

/** The machine settings with the watch judged by `judge`, and its key where one is given. */
function judgedBy(judge: string, key?: string): void {
  const file = join(stateRoot(), "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  const sensors = key ? { [judge]: { key } } : undefined;
  writeFileSync(file, JSON.stringify({ ...settings, attention: { judge }, sensor: sensors }));
}

type Kept = {
  at: string;
  subject: string;
  episode: string;
  by: string;
  state: Record<string, unknown>;
  checks: Record<string, string>;
  questions?: Record<string, Question>;
  model?: string;
  tokens?: number;
  answers?: Record<string, Answer>;
  verdicts?: Record<string, string>;
  unasked?: string;
};

const everAsked = new Set<string>();
const catalog = new Set<string>();

/** What the project's assessments hold, each check it names counted towards the catalog every test file here must reach. */
const kept = (state: string): Kept[] => {
  const file = join(state, "assessments.log");
  const lines = existsSync(file)
    ? readFileSync(file, "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Kept)
    : [];
  for (const line of lines) for (const check of Object.values(line.checks)) everAsked.add(check);
  return lines;
};

after(() =>
  assert.deepEqual(
    [...everAsked].sort(),
    [...catalog].sort(),
    "every question the catalog holds is asked at some moment of the record",
  ),
);

async function lane(h: ReturnType<typeof harness>, hint: string) {
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", {
    title: "Rounding",
    outcome: "money rounds correctly",
    acceptance: ["a"],
    outOfScope: ["anything else"],
  });
  const opened = h.ledger().lanes.L1!;
  await h.call(opened.lead!, "lead", "add_tasks", {
    tasks: [{ key: "t", title: "Round", goal: "g", acceptance: ["a"], hints: [hint], outOfScope: ["the CSV export"] }],
  });
  return { opened, lead: opened.lead!, peer: h.ledger().tasks["L1-T1"]!.peer! };
}

/** A turn of the Peer's: its instruction, in a letter of the kind `from` names, then its calls, one after another. */
function turn(
  timeline: FakeTimeline,
  id: string,
  instruction: string,
  from: string,
  ...calls: Record<string, unknown>[]
) {
  timeline.beat("turn_started", id);
  timeline.add({ type: "user_message", text: instruction, clientMessageId: `sw2-${from}-${id}` }, id);
  calls.forEach((detail, index) =>
    timeline.add(
      {
        type: "tool_call",
        callId: `${id}-${index}`,
        name: String(detail.name ?? detail.type),
        status: "completed",
        detail,
      },
      id,
    ),
  );
}

test("a hand-back is asked about in shadow, and what the sensor says is kept, never sent", async () => {
  const { asked, make, of } = sensor({ summary_admits_gap: 0.9, review_ran_invariant: 0.1 });
  const h = harness({ sensor: make });
  judgedBy("jev", KEY);
  const { opened, lead, peer } = await lane(h, "a.txt");
  h.commit(opened.worktree!, "a.txt", "rounded\n");
  await h.call(peer, "peer", "done", {
    outcome: "complete",
    summary: "Rounds half up; the refund path is stubbed for now.",
  });
  await settle();
  const gap = h.runtime.kit.checks.summary_admits_gap!;
  const summary = { summary: "Rounds half up; the refund path is stubbed for now.", out_of_scope: ["the CSV export"] };
  const question = { type: "noul", instructions: gap.instructions, criteria: gap.criteria };
  assert.deepEqual(asked, [{ key: KEY, state: summary, questions: { summary_admits_gap: question } }]);
  const { at, episode, ...first } = kept(h.project.state)[0]!;
  assert.ok(Date.parse(at) > 0);
  assert.match(episode, /^L1-T1-\d+\.md$/, "the hand-back it is about");
  assert.deepEqual(first, {
    subject: "L1-T1",
    by: "jev",
    state: summary,
    checks: { summary_admits_gap: "summary_admits_gap" },
    questions: { summary_admits_gap: question },
    model: "vendor/model-1-20260917",
    tokens: 321,
    answers: { summary_admits_gap: { noul: 0.9 } },
    verdicts: { summary_admits_gap: "yes" },
  });
  await h.idle(lead);
  assert.match(h.heard(lead).join("\n"), /HANDBACK L1-T1/);
  assert.doesNotMatch(
    h.heard(lead).join("\n"),
    /summary_admits_gap|vendor\/model-1/,
    "in shadow nothing it said reaches a seat",
  );

  await h.call(lead, "lead", "rework", { task: "L1-T1", text: "Do the refund path too." });
  await h.call(peer, "peer", "done", { outcome: "partial", summary: "The refund path needs a key." });
  const review = async (focus: string, verdict: string, extra: Record<string, unknown> = {}) => {
    await h.call(lead, "lead", "start_review", { task: "L1-T1", focus });
    const reviewer = Object.values(h.ledger().tasks)
      .filter((task) => task.kind === "review")
      .at(-1)!.peer!;
    await h.call(reviewer, "reviewer", "done", { verdict, ...extra });
    await settle();
  };
  await review("Is the rounding right?", "accept", { answer: "Right." });
  assert.equal(asked.length, 1, "neither a partial hand-back nor a review of what no risk rule reaches is asked");

  await h.call(lead, "lead", "rework", { task: "L1-T1", text: "Move the totals to cents." });
  mkdirSync(join(opened.worktree!, "db", "migrations"), { recursive: true });
  h.commit(opened.worktree!, "db/migrations/001.sql", "update invoices set total = total * 100;\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "Moved totals to cents." });
  const rounds = {
    answers: ["Guarded by a version row; a backup table keeps the old totals."],
    ran: ["npm run migrate twice"],
  };
  const finding = { severity: "P1", where: "db/migrations/001.sql:1", failure: "no guard", fix: "add one" };
  await review("Is the move safe?", "changes", { answer: "Not yet.", findings: [finding], ...rounds });
  assert.equal(of("review_ran_invariant").length, 0, "a review that sends the change back is not asked");
  await review("Is it safe now?", "accept", { answer: "Safe.", ...rounds });
  for (const check of Object.keys(h.runtime.kit.checks)) catalog.add(check);
  const [ran] = of("review_ran_invariant");
  assert.match(String(ran!.state.report), /^Verdict: accept\n\nSafe\.[^]*Ran: npm run migrate twice$/);
  const rule = h.runtime.kit.ecosystem.riskRules[0]!;
  assert.deepEqual(ran!.questions, {
    review_ran_invariant__1: {
      type: "noul",
      instructions: {
        invariant: rule.invariant,
        question: "Does `report` say that `invariant` was checked by running code?",
      },
      criteria: h.runtime.kit.checks.review_ran_invariant!.criteria,
    },
  });
  assert.deepEqual(
    kept(h.project.state).at(-1)!.verdicts,
    { review_ran_invariant__1: "no" },
    "one per invariant the change reaches",
  );
});

test("a turn's moments are asked about: an act, an unbacked hand-back, a change before any look, and nothing once the instruction is lost", async (t) => {
  const { make, of } = sensor(
    { asked_for: 0.1, claims_checks_pass: 0.95 },
    { choice: "claims_code_bug", confidence: 0.4 },
  );
  const { h, sup, lane: opened, peer, timeline } = await laneWithPeer(undefined, { sensor: make });
  judgedBy("jev", KEY);
  const noticed = noticesOf(h, t);
  const moment = async () => {
    await settle();
    await noticed();
    await settle();
  };
  const copy = h.ledger().tasks["L1-T1"]!.worktree!;
  const read = { type: "read", filePath: join(copy, "src/cart.ts") };
  const edit = { type: "edit", filePath: join(copy, "src/cart.ts"), oldString: "a", newString: "b" };
  const verdicts = (check: string) =>
    kept(h.project.state)
      .filter((line) => Object.values(line.checks).includes(check))
      .map((line) => line.verdicts);

  turn(timeline, "t1", "Clean the build before the release.", "rework", { type: "shell", command: "rm -rf build" });
  await moment();
  const [act] = of("asked_for");
  const instructions = {
    act: "run `rm -rf build`",
    question: "Does `instruction`, `goal` or `acceptance` ask for `act`?",
  };
  assert.deepEqual(act!.state, {
    instruction: "Clean the build before the release.",
    goal: "g",
    acceptance: ["a"],
    out_of_scope: ["the rest of the repository"],
  });
  assert.deepEqual(act!.questions.asked_for__1!.instructions, instructions);
  assert.deepEqual(verdicts("asked_for"), [{ asked_for__1: "no" }]);

  await h.call(sup, "supervisor", "set_project", { gate: "npm test", gateOn: "lane" });
  turn(timeline, "t2", "Round the totals.", "opened", read, edit);
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "Rounded.", checks: "All 35 tests green." });
  timeline.beat("turn_completed", "t2");
  await moment();
  assert.match(
    String(of("claims_checks_pass")[0]!.state.handback),
    /^Outcome: complete\n[^]*Rounded\.[^]*Checks: All 35 tests green\./,
  );
  assert.deepEqual(
    verdicts("claims_checks_pass"),
    [{ claims_checks_pass: "yes" }],
    "a hand-back no gate run after its edit backs",
  );
  await h.call(opened.lead!, "lead", "rework", { task: "L1-T1", text: "Half up, please." });
  turn(timeline, "t3", "Half up, please.", "rework", read, edit, { type: "shell", command: "npm test", exitCode: 1 });
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "Half up now.", checks: "Green." });
  timeline.beat("turn_completed", "t3");
  await moment();
  assert.match(
    String(of("claims_checks_pass")[1]!.state.handback),
    /Half up now\./,
    "and one whose last check failed after its last edit",
  );

  turn(timeline, "t4", "The total is wrong: it rounds half down.", "rework", edit);
  timeline.beat("turn_completed", "t4");
  turn(timeline, "t5", "Still wrong.", "rework", read, edit);
  timeline.beat("turn_completed", "t5");
  turn(timeline, "t6", "Keep going.", "nudge", edit);
  timeline.beat("turn_completed", "t6");
  // A step Paseo adds itself, or asking its Lead, is no look at the code.
  turn(timeline, "t7", "The refund is off by a cent.", "message");
  const step = { type: "tool_call", status: "completed", detail: { type: "unknown" } };
  timeline.add({ ...step, callId: "t7-plan", name: "Plan", metadata: { synthetic: true } }, "t7");
  timeline.add({ ...step, callId: "t7-ask", name: "mcp__team__ask" }, "t7");
  timeline.add({ type: "tool_call", callId: "t7-edit", name: "Edit", status: "completed", detail: edit }, "t7");
  timeline.beat("turn_completed", "t7");
  await moment();
  assert.deepEqual(
    of("instruction_kind").map((entry) => entry.state.instruction),
    ["The total is wrong: it rounds half down.", "The refund is off by a cent."],
    "not after a look, nor after a sender the catalog leaves out",
  );
  assert.deepEqual(
    verdicts("instruction_kind")[0],
    { instruction_kind: "unclear" },
    "a choice below its sure line is unclear",
  );

  const lookless = h.events("watch.fact").filter((event) => event.fact === "edit-before-look").length;
  const asked = of("asked_for").length + of("instruction_kind").length;
  const edits = Array.from({ length: 90 }, (_, index) => ({ ...edit, filePath: join(copy, `src/part${index}.ts`) }));
  turn(timeline, "t8", "Split the cart module, then clean the build.", "rework", read, ...edits, {
    type: "shell",
    command: "rm -rf dist",
  });
  timeline.beat("turn_completed", "t8");
  await moment();
  assert.equal(
    of("asked_for").length + of("instruction_kind").length,
    asked,
    "once the window has lost the instruction, nothing that reads it is asked",
  );
  assert.equal(h.events("watch.fact").filter((event) => event.fact === "edit-before-look").length, lookless);
});

test("nothing is asked when it cannot be, and the Flow tab says who answers and how that stands", async (t) => {
  const judged = sensor({ summary_admits_gap: 0.3 });
  const h = harness({ sensor: judged.make });
  const { lead, peer } = await lane(h, "a.txt");
  const line = async () => {
    const view = await h.rpc(contracts.flow, { project: h.project.slug });
    assert.ok("watch" in view);
    return view.watch.judge;
  };
  const handBack = async (summary: string) => {
    await h.call(peer, "peer", "done", { outcome: "complete", summary });
    await h.call(lead, "lead", "rework", { task: "L1-T1", text: "Again." });
    await settle();
  };

  judgedBy("off", KEY);
  assert.deepEqual(await line(), { label: "", state: "off", minutes: null, detail: null });
  await handBack("first");
  judgedBy("jev");
  assert.deepEqual(await line(), { label: "Jev", state: "nokey", minutes: null, detail: "OpenRouter key" });
  assert.deepEqual(
    (await h.rpc(contracts.catalog, {})).sensors,
    [
      {
        id: "jev",
        label: "Jev",
        key: "OpenRouter key",
        model: "typesafe/jev-1.13",
        terms: "Asked with data collection denied.",
      },
    ],
    "the switch offers each sensor the kit has, by name and the key it takes",
  );
  await handBack("second");
  judgedBy("jev", KEY);
  assert.equal((await line()).state, "waiting");
  const gap = h.runtime.kit.checks.summary_admits_gap!;
  t.after(() => void (gap.mode = "shadow"));
  gap.mode = "off";
  await handBack("off in the catalog");
  gap.mode = "shadow";
  assert.deepEqual([judged.asked.length, kept(h.project.state).length], [0, 0]);

  await handBack("answered");
  assert.deepEqual(await line(), { label: "Jev", state: "answering", minutes: 0, detail: null });
  judged.fail(new Error("503: busy"));
  await handBack("third");
  const unasked = kept(h.project.state).at(-1)!;
  assert.deepEqual(
    [unasked.subject, unasked.unasked, unasked.answers],
    ["L1-T1", "503: busy", undefined],
    "kept, unasked",
  );
  const events = h.events("watch.unasked").map(({ subject, by, error }) => [subject, by, error]);
  assert.deepEqual(events, [["L1-T1", "jev", "503: busy"]]);
  assert.deepEqual(await line(), { label: "Jev", state: "failing", minutes: 0, detail: "503: busy" });
  judgedBy("watcher");
  const other = await line();
  assert.deepEqual(
    other,
    { label: "The Watcher", state: "waiting", minutes: null, detail: null },
    "another judge's line is not its",
  );

  judgedBy("jev", KEY);
  rmSync(join(h.project.state, "assessments.log"));
  mkdirSync(join(h.project.state, "assessments.log"));
  const said = reported(t);
  await handBack("fourth");
  assert.match(
    said(),
    /assessments\.log write failed/,
    "a record that cannot be written is reported, and the desk goes on",
  );
});
