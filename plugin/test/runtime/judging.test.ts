import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import type { SensorSpec } from "../../server/catalog/kit/kit.ts";
import { stateRoot } from "../../server/core/paths.ts";
import type { Answer, Judge, Question } from "../../server/core/ports.ts";
import { loadConfig, saveConfig } from "../../server/desk/project.ts";
import { contracts } from "../../shared/rpc.ts";
import { reported } from "../console.ts";
import { type FakeTimeline, settle } from "./fake-timeline.ts";
import { harness, laneWithPeer } from "./harness.ts";

const KEY = "a-key-for-tests-only";

/** A sensor answering every noul `says` and every choice with `picks`, or failing with `says`, and what it was asked, with which key. */
function sensor(says: number | Error, picks: Answer = { choice: "claims_code_bug", confidence: 0.9 }) {
  const asked: { key: string; state: Record<string, unknown>; questions: Record<string, Question> }[] = [];
  const make = (_spec: SensorSpec, key: string): Judge => ({
    async ask(state, questions) {
      asked.push({ key, state, questions });
      if (says instanceof Error) throw says;
      const answers = Object.fromEntries(Object.entries(questions).map(([name, question]): [string, Answer] => [name, question.type === "noul" ? { noul: says } : picks]));
      return { answers, model: "vendor/model-1-20260917", tokens: 321 };
    },
  });
  return { asked, make };
}

/** The machine settings with the watch judged by `judge`, and its key where one is given. */
function judgedBy(judge: string, key?: string): void {
  const file = join(stateRoot(), "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf-8"));
  writeFileSync(file, JSON.stringify({ ...settings, attention: { judge }, sensor: key ? { [judge]: { key } } : undefined }));
}

type Kept = { at: string; subject: string; episode: string; by: string; state: Record<string, unknown>; checks: Record<string, string>; questions?: Record<string, Question>; model?: string; tokens?: number; answers?: Record<string, Answer>; verdicts?: Record<string, string>; unasked?: string };

const everAsked = new Set<string>();
const catalog = new Set<string>();

/** What the project's assessments hold, each check it names counted towards the catalog every test file here must reach. */
const kept = (state: string): Kept[] => {
  const file = join(state, "assessments.log");
  const lines = existsSync(file) ? readFileSync(file, "utf-8").trim().split("\n").map((line) => JSON.parse(line) as Kept) : [];
  for (const line of lines) for (const check of Object.values(line.checks)) everAsked.add(check);
  return lines;
};

after(() => assert.deepEqual([...everAsked].sort(), [...catalog].sort(), "every question the catalog holds is asked at some moment of the record"));


async function lane(h: ReturnType<typeof harness>, hint: string) {
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Rounding", outcome: "money rounds correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const opened = h.ledger().lanes.L1!;
  await h.call(opened.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Round", goal: "g", acceptance: ["a"], hints: [hint], outOfScope: ["the CSV export"] }] });
  return opened;
}

test("a complete hand-back is asked whether its summary admits a gap, and what the sensor says is kept, not sent", async () => {
  const { asked, make } = sensor(0.9);
  const h = harness({ sensor: make });
  judgedBy("jev", KEY);
  const opened = await lane(h, "a.txt");
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.commit(opened.worktree!, "a.txt", "rounded\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "Rounds half up; the refund path is stubbed for now." });
  await settle();

  const catalog = h.runtime.kit.checks.summary_admits_gap!;
  assert.deepEqual(asked, [{ key: KEY, state: { summary: "Rounds half up; the refund path is stubbed for now.", out_of_scope: ["the CSV export"] }, questions: { summary_admits_gap: { type: "noul", instructions: catalog.instructions, criteria: catalog.criteria } } }]);
  const { at, episode, ...first } = kept(h.project.state)[0]!;
  assert.ok(Date.parse(at) > 0);
  assert.match(episode, /^L1-T1-\d+\.md$/, "the hand-back it is about");
  assert.deepEqual(first, {
    subject: "L1-T1", by: "jev", state: asked[0]!.state, checks: { summary_admits_gap: "summary_admits_gap" },
    questions: asked[0]!.questions, model: "vendor/model-1-20260917", tokens: 321, answers: { summary_admits_gap: { noul: 0.9 } }, verdicts: { summary_admits_gap: "yes" },
  });
  await h.idle(opened.lead!);
  assert.match(h.heard(opened.lead!).join("\n"), /HANDBACK L1-T1/);
  assert.doesNotMatch(h.heard(opened.lead!).join("\n"), /summary_admits_gap|vendor\/model-1/, "in shadow nothing the sensor said reaches a seat");

  await h.call(opened.lead!, "lead", "rework", { task: "L1-T1", text: "Do the refund path too." });
  await h.call(peer, "peer", "done", { outcome: "partial", summary: "The refund path needs a key." });
  await h.call(opened.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is the rounding right?" });
  const reviewer = Object.values(h.ledger().tasks).find((task) => task.kind === "review")!.peer!;
  await h.call(reviewer, "reviewer", "done", { verdict: "accept", answer: "Right." });
  await settle();
  assert.equal(asked.length, 1, "neither a partial hand-back nor a review of what no risk rule reaches is asked");
});

test("a review that accepts a change a risk rule reaches is asked, per invariant, whether its report says it was checked by running code", async () => {
  const { asked, make } = sensor(0.1);
  const h = harness({ sensor: make });
  judgedBy("jev", KEY);
  const opened = await lane(h, "db/migrations");
  mkdirSync(join(opened.worktree!, "db", "migrations"), { recursive: true });
  h.commit(opened.worktree!, "db/migrations/001.sql", "update invoices set total = total * 100;\n");
  await h.call(h.ledger().tasks["L1-T1"]!.peer!, "peer", "done", { outcome: "complete", summary: "Moved totals to cents." });
  await h.call(opened.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is the move safe?" });
  const reviewer = Object.values(h.ledger().tasks).find((task) => task.kind === "review")!.peer!;
  const rounds = { answers: ["Guarded by a version row; a backup table keeps the old totals."], ran: ["npm run migrate twice"] };
  const before = asked.length;
  await h.call(reviewer, "reviewer", "done", { verdict: "changes", answer: "Not yet.", findings: [{ severity: "P1", where: "db/migrations/001.sql:1", failure: "no guard", fix: "add one" }], ...rounds });
  await settle();
  await h.call(opened.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is it safe now?" });
  const second = Object.values(h.ledger().tasks).filter((task) => task.kind === "review").at(-1)!.peer!;
  await h.call(second, "reviewer", "done", { verdict: "accept", answer: "Safe.", ...rounds });
  await settle();
  assert.equal(asked.length, before + 1, "only the review that accepts is asked");

  for (const check of Object.keys(h.runtime.kit.checks)) catalog.add(check);
  const rule = h.runtime.kit.ecosystem.riskRules[0]!;
  const review = asked.at(-1)!;
  assert.match(String(review.state.report), /^Verdict: accept\n\nSafe\.[^]*Ran: npm run migrate twice$/);
  assert.deepEqual(review.questions, { review_ran_invariant__1: { type: "noul", instructions: { invariant: rule.invariant, question: "Does `report` say that `invariant` was checked by running code?" }, criteria: h.runtime.kit.checks.review_ran_invariant!.criteria } });
  assert.deepEqual(kept(h.project.state).at(-1)!.verdicts, { review_ran_invariant__1: "no" });
});

test("nothing is asked with the watch off or a sensor without its key, and a sensor that fails leaves the case on record, unasked", async (t) => {
  const failing = sensor(new Error("503: busy"));
  const h = harness({ sensor: failing.make });
  const opened = await lane(h, "a.txt");
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  const handBack = async (summary: string) => {
    await h.call(opened.lead!, "lead", "rework", { task: "L1-T1", text: "Again." });
    await h.call(peer, "peer", "done", { outcome: "complete", summary });
    await settle();
  };
  judgedBy("off", KEY);
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "first" });
  await settle();
  judgedBy("jev");
  await handBack("second");
  judgedBy("jev", KEY);
  const question = h.runtime.kit.checks.summary_admits_gap!;
  question.mode = "off";
  await handBack("off in the catalog");
  question.mode = "shadow";
  assert.deepEqual([failing.asked.length, kept(h.project.state).length], [0, 0]);

  await handBack("third");
  const [unasked] = kept(h.project.state);
  assert.deepEqual([unasked!.subject, unasked!.unasked, unasked!.answers], ["L1-T1", "503: busy", undefined]);
  assert.deepEqual(h.events("watch.unasked").map(({ subject, by, error }) => [subject, by, error]), [["L1-T1", "jev", "503: busy"]]);

  rmSync(join(h.project.state, "assessments.log"));
  mkdirSync(join(h.project.state, "assessments.log"));
  const said = reported(t);
  await handBack("fourth");
  assert.match(said(), /assessments\.log write failed/, "a record that cannot be written is reported, and the desk goes on");
});

/** A turn of the Peer's: its instruction, in a letter of the kind `from` names, then its calls, one after another. */
function turn(timeline: FakeTimeline, id: string, instruction: string, from: string, ...calls: Record<string, unknown>[]): void {
  timeline.beat("turn_started", id);
  timeline.add({ type: "user_message", text: instruction, clientMessageId: `sw2-${from}-${id}` }, id);
  calls.forEach((detail, index) => timeline.add({ type: "tool_call", callId: `${id}-${index}`, name: String(detail.name ?? detail.type), status: "completed", detail }, id));
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a command that cannot be undone is asked about as an act, against what the seat was told and what its task asks", async () => {
  const { asked, make } = sensor(0.1);
  const { h, timeline } = await laneWithPeer(undefined, { sensor: make });
  judgedBy("jev", KEY);
  turn(timeline, "t1", "Clean the build before the release.", "rework", { type: "shell", command: "rm -rf build" });
  await settle();
  await pause();

  const j1 = asked.find((entry) => "asked_for__1" in entry.questions)!;
  assert.deepEqual(j1.state, { instruction: "Clean the build before the release.", goal: "g", acceptance: ["a"], out_of_scope: ["the rest of the repository"] });
  assert.deepEqual(j1.questions.asked_for__1!.instructions, { act: "run `rm -rf build`", question: "Does `instruction`, `goal` or `acceptance` ask for `act`?" });
  assert.deepEqual(kept(h.project.state).find((line) => "asked_for__1" in line.checks)!.verdicts, { asked_for__1: "no" });
});

test("a hand-back the record does not back is asked whether it says the checks pass", async () => {
  const { asked, make } = sensor(0.95);
  const { h, peer, timeline } = await laneWithPeer(undefined, { sensor: make });
  judgedBy("jev", KEY);
  saveConfig(h.project.state, { ...loadConfig(h.project.state), gate: "npm test", gateOn: "lane" });
  const copy = h.ledger().tasks["L1-T1"]!.worktree!;
  turn(timeline, "t1", "Round the totals.", "opened", { type: "read", filePath: join(copy, "src/cart.ts") }, { type: "edit", filePath: join(copy, "src/cart.ts"), oldString: "a", newString: "b" });
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "Rounded.", checks: "All 35 tests green." });
  timeline.beat("turn_completed", "t1");
  await settle();
  await pause();

  const j4 = asked.find((entry) => "claims_checks_pass" in entry.questions)!;
  assert.match(String(j4.state.handback), /^Outcome: complete\n[^]*Rounded\.[^]*Checks: All 35 tests green\./);
  assert.deepEqual(kept(h.project.state).find((line) => "claims_checks_pass" in line.checks)!.verdicts, { claims_checks_pass: "yes" });

  await h.call(h.ledger().lanes.L1!.lead!, "lead", "rework", { task: "L1-T1", text: "Half up, please." });
  turn(timeline, "t2", "Half up, please.", "rework", { type: "read", filePath: join(copy, "src/cart.ts") }, { type: "edit", filePath: join(copy, "src/cart.ts"), oldString: "b", newString: "c" }, { type: "shell", command: "npm test", exitCode: 1 });
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "Half up now.", checks: "Green." });
  timeline.beat("turn_completed", "t2");
  await settle();
  await pause();
  assert.match(String(asked.filter((entry) => "claims_checks_pass" in entry.questions).at(-1)!.state.handback), /Half up now\./, "and one whose last check, after its last edit, failed");
});

test("a first change made before any look is asked what the instruction did, when it came from a sender the catalog names", async () => {
  const { asked, make } = sensor(0.5, { choice: "claims_code_bug", confidence: 0.4 });
  const { h, timeline } = await laneWithPeer(undefined, { sensor: make });
  judgedBy("jev", KEY);
  const copy = h.ledger().tasks["L1-T1"]!.worktree!;
  const edit = { type: "edit", filePath: join(copy, "src/cart.ts"), oldString: "a", newString: "b" };
  const kinds = () => asked.filter((entry) => "instruction_kind" in entry.questions).map((entry) => entry.state.instruction);
  turn(timeline, "t1", "The total is wrong: it rounds half down.", "rework", edit);
  timeline.beat("turn_completed", "t1");
  turn(timeline, "t2", "Still wrong.", "rework", { type: "read", filePath: join(copy, "src/cart.ts") }, edit);
  timeline.beat("turn_completed", "t2");
  turn(timeline, "t3", "Keep going.", "nudge", edit);
  timeline.beat("turn_completed", "t3");
  // A step Paseo adds itself, or asking its Lead, is no look at the code.
  turn(timeline, "t4", "The refund is off by a cent.", "message");
  timeline.add({ type: "tool_call", callId: "t4-plan", name: "Plan", status: "completed", metadata: { synthetic: true }, detail: { type: "unknown" } }, "t4");
  timeline.add({ type: "tool_call", callId: "t4-ask", name: "mcp__team__ask", status: "completed", detail: { type: "unknown" } }, "t4");
  timeline.add({ type: "tool_call", callId: "t4-edit", name: "Edit", status: "completed", detail: edit }, "t4");
  timeline.beat("turn_completed", "t4");
  await settle();
  await pause();

  assert.deepEqual(kinds(), ["The total is wrong: it rounds half down.", "The refund is off by a cent."], "not after a look, nor after a sender the catalog leaves out");
  assert.deepEqual(kept(h.project.state).find((line) => "instruction_kind" in line.checks)!.verdicts, { instruction_kind: "unclear" }, "a choice below its sure line is unclear");
});

test("once the watch's window has lost the instruction, nothing that reads it is asked, and no first change in view is taken for one made before a look", async () => {
  const { asked, make } = sensor(0.1);
  const { h, timeline } = await laneWithPeer(undefined, { sensor: make });
  judgedBy("jev", KEY);
  const copy = h.ledger().tasks["L1-T1"]!.worktree!;
  const edits = Array.from({ length: 90 }, (_, index) => ({ type: "edit", filePath: join(copy, `src/part${index}.ts`), oldString: "a", newString: "b" }));
  turn(timeline, "t1", "Split the cart module, then clean the build.", "rework", { type: "read", filePath: join(copy, "src/cart.ts") }, ...edits, { type: "shell", command: "rm -rf build" });
  timeline.beat("turn_completed", "t1");
  await settle();
  await pause();

  assert.deepEqual(asked, []);
  assert.deepEqual(h.events("watch.fact").filter((event) => event.fact === "edit-before-look"), []);
});

test("the Flow tab says who answers the watch and how that stands: off, no key, nothing asked yet, answering, or failing", async () => {
  let says: number | Error = 0.3;
  const h = harness({ sensor: () => ({ ask: async (_state, questions) => {
    if (says instanceof Error) throw says;
    return { answers: Object.fromEntries(Object.keys(questions).map((name) => [name, { noul: says as number }])), model: "vendor/model-1" };
  } }) });
  const opened = await lane(h, "a.txt");
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  const line = async () => {
    const view = await h.rpc(contracts.flow, { project: h.project.slug });
    assert.ok("watch" in view);
    return view.watch.judge;
  };
  const handBack = async (again: boolean) => {
    if (again) await h.call(opened.lead!, "lead", "rework", { task: "L1-T1", text: "Again." });
    await h.call(peer, "peer", "done", { outcome: "complete", summary: "Rounded." });
    await settle();
  };

  judgedBy("off");
  assert.deepEqual(await line(), { label: "", state: "off", minutes: null, detail: null });
  judgedBy("jev");
  assert.deepEqual(await line(), { label: "Jev", state: "nokey", minutes: null, detail: "OpenRouter key" });
  assert.deepEqual((await h.rpc(contracts.catalog, {})).sensors, [{ id: "jev", label: "Jev", key: "OpenRouter key", model: "typesafe/jev-1.13", terms: "Asked with data collection denied." }], "the switch offers each sensor the kit has, by name and the key it takes");
  judgedBy("jev", KEY);
  assert.equal((await line()).state, "waiting");
  await handBack(false);
  assert.deepEqual(await line(), { label: "Jev", state: "answering", minutes: 0, detail: null });
  says = new Error("503: busy");
  await handBack(true);
  assert.deepEqual(await line(), { label: "Jev", state: "failing", minutes: 0, detail: "503: busy" });
  judgedBy("watcher");
  assert.deepEqual(await line(), { label: "The Watcher", state: "waiting", minutes: null, detail: null }, "what another judge answered is not its");
});
