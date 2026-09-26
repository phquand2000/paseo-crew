import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { stateRoot } from "../../server/core/paths.ts";
import { settle } from "./fake-timeline.ts";
import { harness, heldRound, laneWithPeer, nobodySeated } from "./harness.ts";
import { hookAgent } from "./noticed.ts";

type Harness = ReturnType<typeof harness>;

/** The machine settings, with the watch judged by `judge`. */
function judgedBy(judge: string): void {
  const file = join(stateRoot(), "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...settings, attention: { judge } }));
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

/** Resolves once `check` holds, as the desk's own awaits run their course; fails after two seconds. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let tries = 0; !check(); tries++) {
    assert.ok(tries < 200, `never: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await settle();
}

const watchersOf = (h: Harness) =>
  [...h.agents.values()].filter((agent) => agent.provider.startsWith("sw2-watcher-") && !agent.archivedAt);

/** The case id a letter or prompt asks about, the last one it names. */
const caseIn = (text: string) => [...text.matchAll(/CASE (C\w+) about/g)].at(-1)![1]!;

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
  };
  const judge = (by: string, id: string, says: string, why = "Nothing is left.") =>
    h.call(by, "watcher", "judge", { case: id, answers: [{ question: "summary_admits_gap", says, why }] });
  return { h, sup, lane, handBack, judge };
}

test("the Watcher's life: seated for a case, answering by the rules, kept while needed, let go after", async (t) => {
  const { h, sup, handBack, judge } = await watched();
  const role = h.runtime.kit.roles.find((entry) => entry.role === "watcher")!;
  const label = role.label;
  role.label = "Case reader";
  t.after(() => void (role.label = label));
  await handBack("Rounds half up; the refund path is stubbed for now.");
  await until(() => watchersOf(h).length === 1, "a Watcher is seated for the case");
  const [watcher] = watchersOf(h);
  assert.equal(watcher!.title, "Case reader", "titled as its role is named");
  assert.equal(watcher!.labels["paseo.parent-agent-id"], sup, "under the Supervisor, so Paseo never pushes its reply");
  assert.equal(watcher!.cwd, h.project.root);
  assert.match(
    watcher!.prompt!,
    /^CASE C\w+ about L1-T1: questions on the fields below\.\n\nsummary:\nRounds half up; the refund path is stubbed for now\.\n\nout_of_scope:\n- the CSV export\n\nQuestions:\nsummary_admits_gap: Does `summary` say that something the task asked for was not done\?\n {3}yes: [^\n]+\n {3}no: [^\n]+\n\nNext: judge C\w+: /,
  );
  const first = caseIn(watcher!.prompt!);
  const said = (answers: { question: string; says: string; why: string }[], id = first, by = watcher!.id) =>
    h.call(by, "watcher", "judge", { case: id, answers });
  const yes = { question: "summary_admits_gap", says: "yes", why: "It says so." };
  assert.match((await said([yes], "C0")).text, /C0 is not waiting for an answer/);
  assert.match(
    (await said([{ ...yes, question: "summary" }])).text,
    /^Nothing was recorded: answer summary_admits_gap once; summary is no question of C\w+\.$/,
  );
  assert.match((await said([yes, yes])).text, /answer summary_admits_gap once/);
  assert.match((await said([{ ...yes, says: "probably" }])).text, /summary_admits_gap takes yes, no, unsure/);
  assert.match((await said([{ ...yes, why: " " }])).text, /give summary_admits_gap a why/);
  assert.match((await said([yes, { ...yes, question: "toString" }])).text, /toString is no question of C\w+/);
  const other = h.add("sw2-watcher-claude/claude-opus-5", h.root, "another Watcher");
  assert.match((await said([yes], first, other)).text, /was sent to another Watcher/);
  h.agents.get(other)!.archivedAt = new Date().toISOString();
  await settle();
  assert.deepEqual(kept(h.project.state), [], "nothing is kept of a refused answer");
  const answered = await judge(watcher!.id, first, "Yes", "It says the refund path is stubbed for now.");
  assert.equal(answered.ok, true, answered.text);
  await settle();
  const [line] = kept(h.project.state);
  assert.deepEqual(
    [line!.by, line!.model, line!.answers, line!.why, line!.verdicts],
    [
      "watcher",
      watcher!.provider,
      { summary_admits_gap: { noul: 1 } },
      { summary_admits_gap: "It says the refund path is stubbed for now." },
      { summary_admits_gap: "yes" },
    ],
    "what it answers is kept beside the case",
  );
  assert.match((await said([yes])).text, /is not waiting for an answer/, "a case is answered once");

  const mailed = () => h.heard(watcher!.id).join("\n");
  await handBack("Rounds half up; the refund path works too.", true);
  await h.idle(watcher!.id);
  await until(() => /the refund path works too/.test(mailed()), "the next case is mailed to it");
  assert.match(mailed(), /CASE C\w+ about L1-T1[^]*the refund path works too\./);
  assert.equal(watchersOf(h).length, 1, "the next case goes to the same Watcher");
  assert.equal((await judge(watcher!.id, caseIn(mailed()), "unsure")).ok, true);
  await settle();
  assert.deepEqual(kept(h.project.state).at(-1)!.verdicts, { summary_admits_gap: "unclear" }, "unsure is the middle");

  await handBack("Rounded, third time.", true);
  await until(() => /third time/.test(mailed()), "the third case is sent");
  await h.tick(Date.now() + 16 * 60_000);
  await settle();
  assert.equal(
    kept(h.project.state).at(-1)!.unasked,
    "no answer within 15 minutes",
    "a case left unanswered is given up",
  );
  assert.equal(watcher!.archivedAt, null, "while a lane is open and the watch is judged by it, the Watcher stays");

  await handBack("Rounded, fourth time.", true);
  await until(() => /fourth time/.test(mailed()), "the fourth case is sent");
  judgedBy("off");
  await h.tick();
  assert.equal(watcher!.archivedAt, null, "judged by something else, it stays while its case waits");
  assert.equal((await judge(watcher!.id, caseIn(mailed()), "no")).ok, true);
  await h.tick();
  assert.ok(watcher!.archivedAt, "and is let go once none does");

  judgedBy("watcher");
  await handBack("Rounded, fifth time.", true);
  await until(() => watchersOf(h).length === 1, "a Watcher is seated again");
  const [renewed] = watchersOf(h);
  assert.equal((await judge(renewed!.id, caseIn(renewed!.prompt!), "no")).ok, true);
  renewed!.status = "idle";
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted after all" })).ok, true);
  await h.tick();
  assert.ok(renewed!.archivedAt, "with no lane open, no case can come, and the idle Watcher is let go");
});

test("cases at once seat one Watcher, and a case is given up only when nobody can take it, never by a round that could not yet see its Watcher", async (t) => {
  const { h, sup, lane, peer, timeline } = await laneWithPeer();
  judgedBy("watcher");
  h.agents.get(sup)!.archivedAt = new Date().toISOString();
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "Rounded." });
  await until(() => kept(h.project.state).length === 1, "the case is kept");
  assert.deepEqual(watchersOf(h), [], "with no Supervisor seated no Watcher is seated");
  assert.match(String(kept(h.project.state)[0]!.unasked), /no Supervisor is seated/);

  h.agents.get(sup)!.archivedAt = null;
  await h.call(sup, "supervisor", "set_project", { gate: "npm test", gateOn: "lane" });
  await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "Again." });
  const copy = h.ledger().tasks["L1-T1"]!.worktree!;
  // A change before any look opens one question, and a hand-back no gate backs another, both as the turn ends.
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "The total is wrong.", clientMessageId: "sw2-rework-t1" }, "t1");
  const edit = { type: "edit", filePath: join(copy, "src/cart.ts"), oldString: "a", newString: "b" };
  timeline.add({ type: "tool_call", callId: "e1", name: "Edit", status: "completed", detail: edit }, "t1");
  await h.call(peer, "peer", "done", { outcome: "partial", summary: "Half of it." });
  timeline.beat("turn_completed", "t1");
  const cases = () => {
    const [watcher] = watchersOf(h);
    if (!watcher) return 0;
    return [watcher.prompt ?? "", ...h.heard(watcher.id)].join("\n").match(/^CASE /gm)?.length ?? 0;
  };
  await until(() => cases() === 2, "both cases reach one Watcher");
  assert.equal(watchersOf(h).length, 1);
  const read = await h.call(watchersOf(h)[0]!.id, "watcher", "record", { of: "L1-T1" });
  assert.equal(read.ok, true, read.text);
  nobodySeated(h);
  await h.tick();
  await settle();
  assert.deepEqual(
    kept(h.project.state)
      .slice(1)
      .map((line) => line.unasked),
    ["the Watcher it was sent to is gone", "the Watcher it was sent to is gone"],
    "with nobody seated, a case whose Watcher has gone is given up by the next round",
  );

  const slow = await watched();
  type Create = (options: { config: { provider: string } }) => Promise<unknown>;
  const workspaces = (slow.h.paseo as { workspaces: { ref: (id: string) => { agents: { create: Create } } } })
    .workspaces;
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
  await slow.handBack("Rounded.");
  await slow.h.tick(Date.now() + 16 * 60_000);
  seat();
  await until(() => watchersOf(slow.h).length === 1, "the Watcher is seated at last");
  const [late] = watchersOf(slow.h);
  assert.equal(
    (await slow.judge(late!.id, caseIn(late!.prompt!), "no")).ok,
    true,
    "its time runs from when it was sent",
  );
  await settle();
  assert.deepEqual(
    kept(slow.h.project.state).map((line) => line.verdicts),
    [{ summary_admits_gap: "no" }],
  );

  late!.archivedAt = new Date().toISOString();
  await slow.h.runtime.archived(hookAgent(slow.h, late!.id));
  const { round, release } = await heldRound(slow.h, t);
  await slow.handBack("Rounded again.", true);
  await until(() => watchersOf(slow.h).length === 1, "a new Watcher is seated while the round is held");
  release();
  await round;
  const [next] = watchersOf(slow.h);
  const answered = await slow.judge(next!.id, caseIn(next!.prompt!), "no");
  assert.equal(
    answered.ok,
    true,
    `a round whose listing was read before its Watcher was seated gave it up: ${answered.text}`,
  );
});
