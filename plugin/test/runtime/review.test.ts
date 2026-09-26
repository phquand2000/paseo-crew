import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { harness } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
const finding = { severity: "P1", where: "a.txt:1", failure: "rounds half down", fix: "round half up" };
const reviews = (h: Harness) => Object.values(h.ledger().tasks).filter((entry) => entry.kind === "review");

/** A lane opened by a supervising seat, with its Lead. */
async function opened(title: string, more: Record<string, unknown> = {}) {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title, outcome: "money rounds correctly", ...scope, ...more });
  const lane = h.ledger().lanes.L1!;
  return { h, sup, lane, lead: lane.lead! };
}

test("a review hands back a verdict and its findings, answers what the project's risk rules ask, and the Lead is told all of it", async () => {
  const { h, sup, lane, lead } = await opened("Rounding");
  await h.call(lead, "lead", "add_tasks", {
    tasks: [{ key: "t", title: "Round", goal: "g", ...scope, hints: ["a.txt"] }],
  });
  h.commit(lane.worktree!, "a.txt", "rounded\n");
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "rounded" });
  await h.idle(peer);

  const wrongLens = await h.call(lead, "lead", "start_review", { focus: "Is the rounding right?", role: "peer" });
  assert.equal(wrongLens.ok, false, "a role that writes does not stand in for one that reads");
  assert.match(wrongLens.text, /no peer that can review/i);
  assert.match(wrongLens.text, /reviewer/, "the refusal names what there is to choose from");

  const started = await h.call(lead, "lead", "start_review", {
    task: "L1-T1",
    focus: "Is half-up right for money here?",
  });
  assert.equal(started.ok, true, started.text);
  const reviewer = h.ledger().tasks["L1-R1"]!.peer!;
  const unnamed = await h.call(reviewer, "reviewer", "done", { verdict: "changes", answer: "Half-up is wrong here." });
  assert.match(unnamed.text, /A verdict of changes names what must change: give each finding\./);
  const handed = await h.call(reviewer, "reviewer", "done", {
    verdict: "accept",
    answer: "Half-up is right for money here.",
    findings: [
      {
        severity: "P3",
        where: "a.txt:1",
        failure: "banker's rounding would be safer at the boundary",
        fix: "none needed: half-up matches the spec",
      },
    ],
    read: ["the diff"],
    ran: ["npm test -- rounding"],
  });
  assert.equal(handed.ok, true, handed.text);
  const verdict = h.ledger().tasks["L1-R1"]!.handback;
  assert.deepEqual([verdict?.outcome, verdict?.summary], ["accept", "Half-up is right for money here."]);
  assert.match(
    h.heard(lead).join("\n"),
    /Verdict: accept\n\nHalf-up is right for money here\.\n\nFindings:\n- P3 a\.txt:1: banker's rounding would be safer at the boundary Fix: none needed: half-up matches the spec\n\nRead: the diff\nRan: npm test -- rounding/,
    "the review itself reaches the Lead rather than being dropped",
  );

  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  await h.call(lead, "lead", "add_tasks", {
    tasks: [{ key: "m", title: "Move", goal: "g", ...scope, hints: ["db/migrations"] }],
  });
  mkdirSync(join(lane.worktree!, "db", "migrations"), { recursive: true });
  h.commit(lane.worktree!, "db/migrations/001.sql", "update invoices set total = total * 100;\n");
  await h.call(h.ledger().tasks["L1-T2"]!.peer!, "peer", "done", { outcome: "complete", summary: "moved" });
  await h.call(lead, "lead", "start_review", { task: "L1-T2", focus: "Is the move safe?" });
  const risky = reviews(h).at(-1)!;
  assert.match(
    h.agents.get(risky.peer!)!.prompt ?? "",
    /The project asks every review of a change like this, answered in order in answers:\n1\. What does running this a second time do to data it already changed, and how is the data from before got back if it goes wrong\?/,
  );
  const bare = await h.call(risky.peer!, "reviewer", "done", { verdict: "accept", answer: "Safe." });
  assert.match(
    bare.text,
    /The project's risk rules ask this review a question; give answers, one per question, in this order:\n1\. What does running this a second time/,
  );
  const answered = await h.call(risky.peer!, "reviewer", "done", {
    verdict: "changes",
    answer: "Not safe twice.",
    answers: ["A second run multiplies totals by 100 again; there is no backup."],
    findings: [
      { severity: "P0", where: "db/migrations/001.sql:1", failure: "totals grow on every run", fix: "a version table" },
    ],
  });
  assert.equal(answered.ok, true, answered.text);
  assert.match(
    h.heard(lead).join("\n"),
    /Asked by the project's risk rules:\n1\. What does running this a second time[^\n]*\n {3}A second run multiplies totals by 100 again; there is no backup\./,
  );

  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  const ofLane = async () => {
    await h.call(lead, "lead", "start_review", { focus: "And the lane?" });
    return reviews(h).at(-1)!.asked;
  };
  assert.match(String(await ofLane()), /What does running this a second time/, "the lane's change reaches the rule");
  const rules = (riskRules: unknown[]) => h.call(sup, "supervisor", "set_project", { riskRules });
  assert.match(
    (await rules([{ paths: ["db"], invariant: "", reviewQuestion: "q" }])).text,
    /invariant must not be empty in each of riskRules/,
  );
  assert.match((await rules([])).text, /0 risk rules of its own/);
  assert.equal(await ofLane(), undefined, "a project's own list, even an empty one, replaces the kit's");
});

test("a lane reported ready carries what its reviews leave standing, and each fact goes once the record settles it", async () => {
  const { h, sup, lane, lead } = await opened("Rounding");
  await h.call(lead, "lead", "add_tasks", {
    tasks: [{ key: "t", title: "Round", goal: "g", ...scope, hints: ["a.txt"] }],
  });
  h.commit(lane.worktree!, "a.txt", "rounded\n");
  await h.call(h.ledger().tasks["L1-T1"]!.peer!, "peer", "done", { outcome: "complete", summary: "rounded" });
  await h.idle(h.ledger().tasks["L1-T1"]!.peer!);
  const start = async (task?: string) => {
    await h.call(lead, "lead", "start_review", { ...(task ? { task } : {}), focus: "Is the rounding right?" });
    return reviews(h).at(-1)!.peer!;
  };
  const handBack = async (reviewer: string, verdict: string) => {
    const findings = verdict === "accept" ? {} : { findings: [finding] };
    const handed = await h.call(reviewer, "reviewer", "done", { verdict, answer: "Read the diff.", ...findings });
    assert.equal(handed.ok, true, handed.text);
    await new Promise((resolve) => setTimeout(resolve, 2));
  };
  const ready = async (summary: string) => (await h.call(lead, "lead", "report", { summary, ready: true })).text;
  const told = () => {
    const heard = h.heard(sup).join("\n");
    return /\nNext: (.*)/.exec(heard.slice(heard.lastIndexOf("REPORT L1")))![1]!;
  };

  await handBack(await start("L1-T1"), "changes");
  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T1" })).ok, true);
  assert.match(
    await ready("first"),
    /No review of the whole lane is on record\. The lane's latest review, L1-R1, ended in changes; L1-T1 was accepted after it, with no review since\. L1-T1 was accepted over L1-R1, a review of it that ended in changes\./,
  );
  assert.match(
    h.heard(sup).join("\n"),
    /REPORT L1 \(Rounding\): ready to land[^]*What the desk read of it:\n[^]*- No review of the whole lane is on record\.\n- The lane's latest review, L1-R1/,
  );
  assert.match(
    told(),
    /^Its reviews asked for changes that nothing on record answers/,
    "accepted on the very hand-back its review asked changes to",
  );

  // Latest by when it came back, not by when it was asked for.
  const [asked, second] = [await start(), await start()];
  await handBack(second, "accept");
  await handBack(asked, "changes");
  const again = await ready("second");
  assert.doesNotMatch(again, /No review of the whole lane/);
  assert.match(
    again,
    /The lane's latest review, L1-R2, ended in changes, and nothing was accepted after it\. L1-T1 was accepted over L1-R1/,
  );
  assert.match(told(), /^Its reviews asked for changes that nothing on record answers/);

  await handBack(await start(), "accept");
  const third = await ready("third");
  assert.doesNotMatch(third, /latest review/);
  assert.match(
    third,
    /It also carries what the record has of the lane's reviews: L1-T1 was accepted over L1-R1, a review of it that ended in changes\. Stay quiet/,
    "the Lead's own acceptance stands on the record, for whoever lands it to weigh",
  );
  assert.match(told(), /^land_lane it if acceptance is met/, "a review of the whole lane accepted it since");
});

test("a review's changes stand until a hand-back after them or a review accepting the task answers them, and only then does the report stop asking", async () => {
  const { h, sup, lane, lead } = await opened("Rounding");
  const tick = () => new Promise((resolve) => setTimeout(resolve, 2));
  const handBack = async (task: string, file: string, text: string) => {
    h.commit(lane.worktree!, file, `${text}\n`);
    await h.call(h.ledger().tasks[task]!.peer!, "peer", "done", { outcome: "complete", summary: text });
    await h.idle(h.ledger().tasks[task]!.peer!);
    await tick();
  };
  const review = async (task: string, verdict: string) => {
    await h.call(lead, "lead", "start_review", { task, focus: "Is the rounding right?" });
    const reviewer = reviews(h).at(-1)!.peer!;
    const findings = verdict === "accept" ? {} : { findings: [finding] };
    assert.equal(
      (await h.call(reviewer, "reviewer", "done", { verdict, answer: "Read the diff.", ...findings })).ok,
      true,
    );
    await tick();
  };
  const accept = async (task: string) => {
    assert.equal((await h.call(lead, "lead", "accept", { task })).ok, true);
    await tick();
  };
  const ready = async () => {
    const reply = (await h.call(lead, "lead", "report", { summary: "done", ready: true })).text;
    const heard = h.heard(sup).join("\n");
    return { reply, next: /\nNext: (.*)/.exec(heard.slice(heard.lastIndexOf("REPORT L1")))![1]! };
  };
  const add = (key: string, hint: string) =>
    h.call(lead, "lead", "add_tasks", { tasks: [{ key, title: "Round", goal: "g", ...scope, hints: [hint] }] });

  await add("t", "a.txt");
  await handBack("L1-T1", "a.txt", "rounded");
  await review("L1-T1", "changes");
  await h.call(lead, "lead", "rework", { task: "L1-T1", text: "Round half up, as L1-R1 asks." });
  await handBack("L1-T1", "a.txt", "rounds half up now");
  await accept("L1-T1");
  const reworked = await ready();
  assert.match(
    reworked.reply,
    /L1-T1 was handed back again after L1-R1, a review of it that ended in changes, and accepted with no review since\./,
  );
  assert.doesNotMatch(reworked.reply, /accepted over L1-R1/);
  assert.match(
    reworked.next,
    /^land_lane it if acceptance is met/,
    "the rework answered the review, though no review read it",
  );

  await add("u", "b.txt");
  await handBack("L1-T2", "b.txt", "rounded totals");
  await review("L1-T2", "changes");
  await accept("L1-T2");
  const over = await ready();
  assert.equal(
    h.heard(sup).join("\n").split("REPORT L1 ").length - 1,
    2,
    "the same summary again still reaches the Supervisor once what the desk read of the lane changed",
  );
  assert.match(
    over.next,
    /^Its reviews asked for changes that nothing on record answers/,
    "accepted on the very hand-back its review asked changes to",
  );
  await review("L1-T1", "accept");
  assert.match(
    (await ready()).next,
    /^Its reviews asked for changes that nothing on record answers/,
    "a review of another task accepting answers nothing of L1-T2's",
  );
  await review("L1-T2", "accept");
  assert.match((await ready()).next, /^land_lane it if acceptance is met/, "its own review accepted it since");
});

test("a review reads a task where its work is: in the task's own copy until it merges, and in the merge on the lane once it has", async () => {
  const { h, lane, lead } = await opened("Reviewed", { writeSet: ["a.txt", "b.txt"] });
  const beside = async (title: string, file: string) => {
    await h.call(lead, "lead", "add_tasks", {
      tasks: [{ key: "t", title, goal: "g", ...scope, holds: [file], parallel: true }],
    });
    return Object.values(h.ledger().tasks).find((entry) => entry.title === title)!;
  };
  const task = await beside("A", "a.txt");
  h.commit(task.worktree!, "a.txt", "A\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  await h.idle(task.peer!);

  assert.equal((await h.call(lead, "lead", "start_review", { task: "L1-T1", focus: "Is this right?" })).ok, true);
  const first = reviews(h).at(-1)!;
  assert.equal(first.slot, task.slot, "the reviewer reads the task's commits in that task's own copy");
  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.ok(existsSync(first.worktree!), "the reviewer is mid-turn, and its verdict is what the Lead waits for");
  h.agents.get(first.peer!)!.status = "idle";
  await h.endTurn(first.peer!, "verdict sent");
  assert.ok(
    existsSync(first.worktree!),
    "once it stops, the copy stays with the task's Peer until its Lead releases it",
  );
  assert.equal(h.ledger().slots[task.slot!]?.task, "L1-T1", "and holds nothing the lane lacks");

  assert.equal((await h.call(lead, "lead", "start_review", { task: "L1-T1", focus: "At the boundary?" })).ok, true);
  const late = reviews(h).at(-1)!;
  const merge = h.ledger().tasks["L1-T1"]!.mergeSha!;
  const brief = h.agents.get(late.peer!)!.prompt!;
  assert.match(brief, new RegExp(`The change is in ${lane.branch}, as the merge ${merge.slice(0, 7)}`));
  assert.match(brief, new RegExp(`git diff ${merge}\\^1\\.\\.${merge}`), "a range that shows nothing reviews nothing");
  assert.equal(h.git(lane.worktree!, "diff", "--name-only", `${merge}^1..${merge}`).trim(), "a.txt");
  assert.equal(h.agents.get(late.peer!)!.cwd, lane.worktree, "read from the lane's copy");
  assert.notEqual(late.worktree, task.worktree, "not from the copy its Peer keeps");

  // A task cut before it committed leaves neither a copy nor a branch, and there is nothing to read.
  const empty = await beside("B", "b.txt");
  const cut = await h.call(lead, "lead", "cut", { task: empty.id, reason: "wrong shape" });
  assert.equal(cut.ok, true, cut.text);
  assert.equal(h.git(h.root, "branch", "--list", empty.branch!).trim(), "", "no commits of its own, no branch");
  const nothing = await h.call(lead, "lead", "start_review", { task: empty.id, focus: "anything?" });
  assert.equal(nothing.ok, false);
  assert.match(nothing.text, /neither a merge nor a branch is left to read it from/);
});
