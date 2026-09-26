import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { stateRoot } from "../../server/core/paths.ts";
import { loadConfig, saveConfig } from "../../server/desk/project.ts";
import { settle } from "./fake-timeline.ts";
import { harness, heldRound, laneWithPeer, nobodySeated } from "./harness.ts";

/** The machine settings, with the watch judged by `judge`. */
function judgedBy(judge: string): void {
  const file = join(stateRoot(), "settings.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf-8")), attention: { judge } }));
}

const kept = (state: string) => {
  const file = join(state, "assessments.log");
  return existsSync(file)
    ? readFileSync(file, "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
};

/** A lane with a Peer that hands back complete, the watch judged by the Watcher: each hand-back is a case. */
async function watched() {
  const h = harness();
  judgedBy("watcher");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", {
    title: "Rounding",
    outcome: "money rounds correctly",
    acceptance: ["a"],
    outOfScope: ["anything else"],
  });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", {
    tasks: [
      { key: "t", title: "Round", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the CSV export"] },
    ],
  });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  const handBack = async (summary: string, again = false) => {
    if (again) await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "Again." });
    await h.call(peer, "peer", "done", { outcome: "complete", summary });
    await settle();
    await settle();
  };
  const watchers = () => [...h.agents.values()].filter((agent) => agent.provider.startsWith("sw2-watcher-"));
  const caseOf = (text: string) => /CASE (C\w+) about/.exec(text)![1]!;
  return { h, sup, lane, handBack, watchers, caseOf };
}

test("a case seats one Watcher under the project's Supervisor, the case its first word, and what it answers is kept beside the case", async (t) => {
  const { h, sup, handBack, watchers, caseOf } = await watched();
  const role = h.runtime.kit.roles.find((entry) => entry.role === "watcher")!;
  const label = role.label;
  role.label = "Case reader";
  t.after(() => {
    role.label = label;
  });
  await handBack("Rounds half up; the refund path is stubbed for now.");

  const [watcher] = watchers();
  assert.ok(watcher, "a Watcher is seated for the case");
  assert.equal(watcher.title, "Case reader", "titled as its role is named");
  assert.equal(
    watcher.labels["paseo.parent-agent-id"],
    sup,
    "under the Supervisor, so Paseo never pushes its reply to the Human's phone",
  );
  assert.equal(watcher.cwd, h.project.root);
  assert.match(
    watcher.prompt!,
    /^CASE C\w+ about L1-T1: questions on the fields below\.\n\nsummary:\nRounds half up; the refund path is stubbed for now\.\n\nout_of_scope:\n- the CSV export\n\nQuestions:\nsummary_admits_gap: Does `summary` say that something the task asked for was not done\?\n {3}yes: [^\n]+\n {3}no: [^\n]+\n\nNext: judge C\w+: /,
  );
  const id = caseOf(watcher.prompt!);
  const answered = await h.call(watcher.id, "watcher", "judge", {
    case: id,
    answers: [{ question: "summary_admits_gap", says: "Yes", why: "It says the refund path is stubbed for now." }],
  });
  assert.equal(answered.ok, true, answered.text);
  await settle();
  const [line] = kept(h.project.state);
  assert.deepEqual(
    [line!.by, line!.model, line!.answers, line!.why, line!.verdicts],
    [
      "watcher",
      watcher.provider,
      { summary_admits_gap: { noul: 1 } },
      { summary_admits_gap: "It says the refund path is stubbed for now." },
      { summary_admits_gap: "yes" },
    ],
  );

  await handBack("Rounds half up; the refund path works too.", true);
  assert.equal(watchers().length, 1, "the next case goes to the same Watcher");
  await h.idle(watcher.id);
  assert.match(h.heard(watcher.id).join("\n"), /CASE C\w+ about L1-T1[^]*the refund path works too\./);
});

test("an answer that is not every question once, in words its question takes, with a why, is refused and nothing is kept", async () => {
  const { h, handBack, watchers, caseOf } = await watched();
  await handBack("Rounded.");
  const watcher = watchers()[0]!;
  const id = caseOf(watcher.prompt!);
  const judge = (answers: { question: string; says: string; why: string }[], caseId = id, by = watcher.id) =>
    h.call(by, "watcher", "judge", { case: caseId, answers });
  const yes = { question: "summary_admits_gap", says: "yes", why: "It says so." };

  assert.match((await judge([yes], "C0")).text, /C0 is not waiting for an answer/);
  assert.match(
    (await judge([{ ...yes, question: "summary" }])).text,
    /^Nothing was recorded: answer summary_admits_gap once; summary is no question of C\w+\.$/,
  );
  assert.match((await judge([yes, yes])).text, /answer summary_admits_gap once/);
  assert.match((await judge([{ ...yes, says: "probably" }])).text, /summary_admits_gap takes yes, no, unsure/);
  assert.match((await judge([{ ...yes, why: " " }])).text, /give summary_admits_gap a why/);
  assert.match((await judge([yes, { ...yes, question: "toString" }])).text, /toString is no question of C\w+/);
  const other = h.add("sw2-watcher-claude/claude-opus-5", h.root, "another Watcher");
  assert.match((await judge([yes], id, other)).text, /was sent to another Watcher/);
  await settle();
  assert.deepEqual(kept(h.project.state), [], "nothing is kept of a refused answer");

  assert.equal((await judge([{ ...yes, says: "unsure" }])).ok, true);
  await settle();
  assert.deepEqual(
    kept(h.project.state)[0]!.verdicts,
    { summary_admits_gap: "unclear" },
    "unsure is the middle of the scale",
  );
  assert.match((await judge([yes])).text, /is not waiting for an answer/, "a case is answered once");
});

test("with no Supervisor seated no Watcher is seated, and the case is kept, unasked", async () => {
  const { h, sup, handBack, watchers } = await watched();
  h.agents.get(sup)!.archivedAt = new Date().toISOString();
  await handBack("Rounded.");
  assert.deepEqual(watchers(), []);
  assert.match(String(kept(h.project.state)[0]!.unasked), /no Supervisor is seated/);
});

test("a case left unanswered is given up after a while, and the Watcher is let go once no lane is open", async () => {
  const { h, sup, handBack, watchers } = await watched();
  await handBack("Rounded.");
  const watcher = watchers()[0]!;
  watcher.status = "idle";
  await h.tick(Date.now() + 16 * 60_000);
  await settle();
  assert.equal(kept(h.project.state)[0]!.unasked, "no answer within 15 minutes");
  assert.equal(watcher.archivedAt, null, "while a lane is open and the watch is judged by it, the Watcher stays");

  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted after all" })).ok, true);
  await h.tick();
  assert.ok(watcher.archivedAt, "with no lane open, no case can come, and the idle Watcher is let go");
});

test("with nobody seated, a case whose Watcher has gone is given up by the next round", async () => {
  const { h, handBack, watchers } = await watched();
  await handBack("Rounded.");
  assert.equal(watchers().length, 1);
  nobodySeated(h);
  await h.tick();
  await settle();
  assert.equal(kept(h.project.state)[0]!.unasked, "the Watcher it was sent to is gone");
});

test("a case is not given up while its Watcher is still being seated: its time runs from when it is sent", async (t) => {
  const { h, handBack, watchers, caseOf } = await watched();
  type Create = (options: { config: { provider: string } }) => Promise<unknown>;
  const workspaces = (h.paseo as { workspaces: { ref(id: string): { agents: { create: Create } } } }).workspaces;
  const ref = workspaces.ref;
  let seat = () => {};
  const seated = new Promise<void>((resolve) => (seat = resolve));
  t.mock.method(workspaces, "ref", (id: string) => {
    const real = ref(id);
    const create: Create = async (options) => {
      if (options.config.provider.startsWith("sw2-watcher-")) await seated;
      return real.agents.create(options);
    };
    return { ...real, agents: { create } };
  });
  await handBack("Rounded.");
  await h.tick(Date.now() + 16 * 60_000);
  seat();
  await settle();
  const watcher = watchers()[0]!;

  const answered = await h.call(watcher.id, "watcher", "judge", {
    case: caseOf(watcher.prompt!),
    answers: [{ question: "summary_admits_gap", says: "no", why: "Nothing is left." }],
  });
  assert.equal(answered.ok, true, answered.text);
  await settle();
  assert.deepEqual(
    kept(h.project.state).map((line) => line.verdicts),
    [{ summary_admits_gap: "no" }],
  );
});

test("a case sent while a round runs is not given up by that round, whose listing was read before its Watcher was seated", async (t) => {
  const { h, handBack, watchers, caseOf } = await watched();
  const { round, release } = await heldRound(h, t);
  await handBack("Rounded.");
  release();
  await round;

  const watcher = watchers()[0]!;
  const answered = await h.call(watcher.id, "watcher", "judge", {
    case: caseOf(watcher.prompt!),
    answers: [{ question: "summary_admits_gap", says: "no", why: "Nothing is left." }],
  });
  assert.equal(answered.ok, true, answered.text);
});

test("the Watcher is let go once the watch is judged by something else, and not while a case waits on it", async () => {
  const { h, handBack, watchers } = await watched();
  await handBack("Rounded.");
  const watcher = watchers()[0]!;
  watcher.status = "idle";
  judgedBy("off");
  await h.tick();
  assert.equal(watcher.archivedAt, null, "its case still waits");
  await h.call(watcher.id, "watcher", "judge", {
    case: /CASE (C\w+)/.exec(watcher.prompt!)![1]!,
    answers: [{ question: "summary_admits_gap", says: "no", why: "Nothing is left." }],
  });
  await h.tick();
  assert.ok(watcher.archivedAt, "judged by nothing, the idle Watcher is let go");
});

test("two cases of one moment seat one Watcher, and it may read the steps of the seat a case is about", async () => {
  const { h, peer, timeline } = await laneWithPeer();
  judgedBy("watcher");
  saveConfig(h.project.state, { ...loadConfig(h.project.state), gate: "npm test", gateOn: "lane" });
  const copy = h.ledger().tasks["L1-T1"]!.worktree!;
  // A change before any look opens one question, and a hand-back no gate backs another, both as the turn ends.
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "The total is wrong.", clientMessageId: "sw2-rework-t1" }, "t1");
  timeline.add(
    {
      type: "tool_call",
      callId: "e1",
      name: "Edit",
      status: "completed",
      detail: { type: "edit", filePath: join(copy, "src/cart.ts"), oldString: "a", newString: "b" },
    },
    "t1",
  );
  await h.call(peer, "peer", "done", { outcome: "partial", summary: "Half of it." });
  timeline.beat("turn_completed", "t1");
  for (let round = 0; round < 5; round++) await settle();

  const watchers = [...h.agents.values()].filter((agent) => agent.provider.startsWith("sw2-watcher-"));
  assert.equal(watchers.length, 1);
  assert.equal(
    [
      ...watchers[0]!.prompt!.matchAll(/^CASE /gm),
      ...h.heard(watchers[0]!.id).flatMap((text) => [...text.matchAll(/^CASE /gm)]),
    ].length,
    2,
    "both cases reach it",
  );
  const read = await h.call(watchers[0]!.id, "watcher", "record", { of: "L1-T1" });
  assert.equal(read.ok, true, read.text);
});
