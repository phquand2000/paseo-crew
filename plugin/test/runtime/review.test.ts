import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { harness } from "./harness.ts";

test("a review hands back a verdict and its findings, and the Lead is told both", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Rounding", outcome: "money rounds correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Round", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] }] });
  h.commit(lane.worktree!, "a.txt", "rounded\n");
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "rounded" });
  h.agents.get(peer)!.status = "idle";

  const opened = await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is half-up right for money here?" });
  assert.equal(opened.ok, true, opened.text);
  const review = Object.values(h.ledger().tasks).find((task) => task.kind === "review")!;
  const reviewer = review.peer!;

  // A reviewer hands back a judgement in its own tool set's words, which must reach the Lead intact.
  const finding = { severity: "P3", where: "a.txt:1", failure: "banker's rounding would be safer at the boundary", fix: "none needed: half-up matches the spec" };
  const unnamed = await h.call(reviewer, "reviewer", "done", { verdict: "changes", answer: "Half-up is wrong here." });
  assert.match(unnamed.text, /A verdict of changes names what must change: give each finding\./);
  const handed = await h.call(reviewer, "reviewer", "done", { verdict: "accept", answer: "Half-up is right for money here.", findings: [finding], read: ["the diff"], ran: ["npm test -- rounding"] });
  assert.equal(handed.ok, true, handed.text);
  assert.equal(h.ledger().tasks[review.id]!.handback?.outcome, "accept", "an accepted review is recorded as accepted, not as changes");
  assert.equal(h.ledger().tasks[review.id]!.handback?.summary, "Half-up is right for money here.");

  await h.idle(lane.lead!);
  const toLead = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(toLead, /Verdict: accept\n\nHalf-up is right for money here\.\n\nFindings:\n- P3 a\.txt:1: banker's rounding would be safer at the boundary Fix: none needed: half-up matches the spec\n\nRead: the diff\nRan: npm test -- rounding/, "the review itself reaches the Lead rather than being dropped");
});

test("a lane reported ready carries what its reviews leave standing, and each fact goes once the record settles it", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Rounding", outcome: "money rounds correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Round", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] }] });
  h.commit(lane.worktree!, "a.txt", "rounded\n");
  await h.call(h.ledger().tasks["L1-T1"]!.peer!, "peer", "done", { outcome: "complete", summary: "rounded" });
  await h.idle(h.ledger().tasks["L1-T1"]!.peer!);
  const finding = { severity: "P1", where: "a.txt:1", failure: "rounds half down", fix: "round half up" };
  const start = async (task?: string) => {
    await h.call(lane.lead!, "lead", "start_review", { ...(task ? { task } : {}), focus: "Is the rounding right?" });
    return Object.values(h.ledger().tasks).filter((entry) => entry.kind === "review").at(-1)!.peer!;
  };
  const handBack = async (reviewer: string, verdict: string) => {
    const handed = await h.call(reviewer, "reviewer", "done", { verdict, answer: "Read the diff.", ...(verdict === "accept" ? {} : { findings: [finding] }) });
    assert.equal(handed.ok, true, handed.text);
    await new Promise((resolve) => setTimeout(resolve, 2));
  };
  const ready = async (summary: string) => (await h.call(lane.lead!, "lead", "report", { summary, ready: true })).text;
  const told = () => {
    const heard = h.heard(sup).join("\n");
    return /\nNext: (.*)/.exec(heard.slice(heard.lastIndexOf("REPORT L1")))![1]!;
  };

  await handBack(await start("L1-T1"), "changes");
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  const first = await ready("first");
  assert.match(first, /No review of the whole lane is on record\. The lane's latest review, L1-R1, ended in changes; L1-T1 was accepted after it, with no review since\. L1-T1 was accepted over L1-R1, a review of it that ended in changes\./);
  assert.match(h.heard(sup).join("\n"), /REPORT L1 \(Rounding\): ready to land[^]*What the desk read of it:\n[^]*- No review of the whole lane is on record\.\n- The lane's latest review, L1-R1/);
  assert.match(told(), /^Its reviews asked for changes that nothing on record answers/, "accepted on the very hand-back its review asked changes to");

  // Latest by when it came back, not by when it was asked for.
  const [asked, second] = [await start(), await start()];
  await handBack(second, "accept");
  await handBack(asked, "changes");
  const again = await ready("second");
  assert.doesNotMatch(again, /No review of the whole lane/);
  assert.match(again, /The lane's latest review, L1-R2, ended in changes, and nothing was accepted after it\. L1-T1 was accepted over L1-R1/);
  assert.match(told(), /^Its reviews asked for changes that nothing on record answers/);

  await handBack(await start(), "accept");
  const third = await ready("third");
  assert.doesNotMatch(third, /latest review/);
  assert.match(third, /It also carries what the record has of the lane's reviews: L1-T1 was accepted over L1-R1, a review of it that ended in changes\. Stay quiet/, "the Lead's own acceptance stands on the record, for whoever lands it to weigh");
  assert.match(told(), /^land_lane it if acceptance is met/, "a review of the whole lane accepted it since");
});

test("a review's changes stand until a hand-back after them or a review accepting the task answers them, and only then does the report stop asking", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Rounding", outcome: "money rounds correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 2));
  const handBack = async (task: string, file: string, text: string) => {
    h.commit(lane.worktree!, file, `${text}\n`);
    await h.call(h.ledger().tasks[task]!.peer!, "peer", "done", { outcome: "complete", summary: text });
    await h.idle(h.ledger().tasks[task]!.peer!);
    await tick();
  };
  const review = async (task: string, verdict: string) => {
    await h.call(lane.lead!, "lead", "start_review", { task, focus: "Is the rounding right?" });
    const reviewer = Object.values(h.ledger().tasks).filter((entry) => entry.kind === "review").at(-1)!.peer!;
    const findings = verdict === "accept" ? {} : { findings: [{ severity: "P1", where: "a.txt:1", failure: "rounds half down", fix: "round half up" }] };
    assert.equal((await h.call(reviewer, "reviewer", "done", { verdict, answer: "Read the diff.", ...findings })).ok, true);
    await tick();
  };
  const accept = async (task: string) => {
    assert.equal((await h.call(lane.lead!, "lead", "accept", { task })).ok, true);
    await tick();
  };
  const ready = async () => {
    const reply = (await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true })).text;
    const heard = h.heard(sup).join("\n");
    return { reply, next: /\nNext: (.*)/.exec(heard.slice(heard.lastIndexOf("REPORT L1")))![1]! };
  };
  const add = (key: string, hint: string) => h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key, title: "Round", goal: "g", acceptance: ["a"], hints: [hint], outOfScope: ["the rest"] }] });

  await add("t", "a.txt");
  await handBack("L1-T1", "a.txt", "rounded");
  await review("L1-T1", "changes");
  await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "Round half up, as L1-R1 asks." });
  await handBack("L1-T1", "a.txt", "rounds half up now");
  await accept("L1-T1");
  const reworked = await ready();
  assert.match(reworked.reply, /L1-T1 was handed back again after L1-R1, a review of it that ended in changes, and accepted with no review since\./);
  assert.doesNotMatch(reworked.reply, /accepted over L1-R1/);
  assert.match(reworked.next, /^land_lane it if acceptance is met/, "the rework answered the review, though no review read it");

  await add("u", "b.txt");
  await handBack("L1-T2", "b.txt", "rounded totals");
  await review("L1-T2", "changes");
  await accept("L1-T2");
  const over = await ready();
  assert.equal(h.heard(sup).join("\n").split("REPORT L1 ").length - 1, 2, "the same summary again still reaches the Supervisor once what the desk read of the lane changed");
  assert.match(over.next, /^Its reviews asked for changes that nothing on record answers/, "accepted on the very hand-back its review asked changes to");
  await review("L1-T1", "accept");
  assert.match((await ready()).next, /^Its reviews asked for changes that nothing on record answers/, "a review of another task accepting answers nothing of L1-T2's");
  await review("L1-T2", "accept");
  assert.match((await ready()).next, /^land_lane it if acceptance is met/, "its own review accepted it since");
});

test("a review of a change a risk rule covers is asked the rule's question, and its verdict is refused until it answers", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Invoices", outcome: "invoices move", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "m", title: "Move", goal: "g", acceptance: ["a"], hints: ["db/migrations"], outOfScope: ["the rest"] }] });
  mkdirSync(join(lane.worktree!, "db", "migrations"), { recursive: true });
  h.commit(lane.worktree!, "db/migrations/001.sql", "update invoices set total = total * 100;\n");
  await h.call(h.ledger().tasks["L1-T1"]!.peer!, "peer", "done", { outcome: "complete", summary: "moved" });

  await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is the move safe?" });
  const review = Object.values(h.ledger().tasks).find((task) => task.kind === "review")!;
  assert.match(h.agents.get(review.peer!)!.prompt ?? "", /The project asks every review of a change like this, answered in order in answers:\n1\. What does running this a second time do to data it already changed, and how is the data from before got back if it goes wrong\?/);
  const bare = await h.call(review.peer!, "reviewer", "done", { verdict: "accept", answer: "Safe." });
  assert.match(bare.text, /The project's risk rules ask this review a question; give answers, one per question, in this order:\n1\. What does running this a second time/);
  const answered = await h.call(review.peer!, "reviewer", "done", { verdict: "changes", answer: "Not safe twice.", answers: ["A second run multiplies totals by 100 again; there is no backup."], findings: [{ severity: "P0", where: "db/migrations/001.sql:1", failure: "totals grow on every run", fix: "guard it with a version table" }] });
  assert.equal(answered.ok, true, answered.text);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /Asked by the project's risk rules:\n1\. What does running this a second time[^\n]*\n {3}A second run multiplies totals by 100 again; there is no backup\./);

  assert.match((await h.call(sup, "supervisor", "set_project", { riskRules: [{ paths: ["db"], invariant: "", reviewQuestion: "q" }] })).text, /invariant must not be empty in each of riskRules/);
  assert.match((await h.call(sup, "supervisor", "set_project", { riskRules: [] })).text, /0 risk rules of its own/);
  await h.call(lane.lead!, "lead", "start_review", { focus: "And the lane?" });
  const second = Object.values(h.ledger().tasks).filter((task) => task.kind === "review").at(-1)!;
  assert.equal(second.asked, undefined, "a project's own list, even an empty one, replaces the kit's");
});

test("a copy a reviewer is reading is not taken away when the task it reviews is accepted", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["the rest of the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Reviewed", outcome: "a and b change", acceptance: ["a"], outOfScope: ["anything else in the repository"], writeSet: ["a.txt", "b.txt"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A", goal: "g", acceptance: ["a"], holds: ["a.txt"], ...scope, parallel: true }] });
  const task = h.ledger().tasks["L1-T1"]!;
  h.commit(task.worktree!, "a.txt", "A\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(task.peer!)!.status = "idle";

  // The documented way to review a task's commits: it reads them in that task's own working copy.
  assert.equal((await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is this right at the boundary?" })).ok, true);
  const review = Object.values(h.ledger().tasks).find((entry) => entry.kind === "review")!;
  assert.equal(review.slot, task.slot, "the ledger says which copy the reviewer is living in");

  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.equal(existsSync(review.worktree!), true, "the reviewer is mid-turn, and its verdict is what the Lead was told to wait for");

  h.agents.get(review.peer!)!.status = "idle";
  await h.endTurn(review.peer!, "verdict sent");
  assert.equal(existsSync(review.worktree!), true, "once it stops, the copy stays with the task's Peer until its Lead releases it");

  // A review of a task already merged reads the merge from the lane's copy, not from the copy its Peer keeps.
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "B", goal: "g", acceptance: ["b"], holds: ["b.txt"], ...scope, parallel: true }] });
  const second = Object.values(h.ledger().tasks).find((entry) => entry.title === "B")!;
  h.commit(second.worktree!, "b.txt", "B\n");
  await h.call(second.peer!, "peer", "done", { outcome: "complete", summary: "b" });
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: second.id })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().slots[second.slot!]?.task, second.id, "its copy stays with its Peer");

  assert.equal((await h.call(lane.lead!, "lead", "start_review", { task: second.id, focus: "and this one?" })).ok, true);
  const late = Object.values(h.ledger().tasks).find((entry) => entry.kind === "review" && entry.of === second.id)!;
  assert.notEqual(late.worktree, second.worktree, "it reads the merge from the lane's copy instead");
  assert.match(h.agents.get(late.peer!)!.prompt!, /as the merge/);
});

test("a review of a merged parallel task is pointed at the merge that holds the change", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["the rest of the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Two files", outcome: "both change", acceptance: ["a"], outOfScope: ["anything else in the repository"], writeSet: ["a.txt", "b.txt"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A", goal: "g", acceptance: ["a"], holds: ["a.txt"], ...scope, parallel: true }] });
  const task = h.ledger().tasks["L1-T1"]!;
  h.commit(task.worktree!, "a.txt", "A\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(task.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.equal(h.ledger().slots[task.slot!]?.task, "L1-T1", "the copy it worked in stays with its Peer, and holds nothing the lane lacks");

  const opened = await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Does this hold at the boundary?" });
  assert.equal(opened.ok, true, opened.text);
  const review = Object.values(h.ledger().tasks).find((entry) => entry.kind === "review")!;
  const merge = h.ledger().tasks["L1-T1"]!.mergeSha!;
  const brief = h.agents.get(review.peer!)!.prompt!;
  assert.match(brief, new RegExp(`The change is in ${lane.branch}, as the merge ${merge.slice(0, 7)}`), "once merged, the work is read where it landed");
  assert.match(brief, new RegExp(`git diff ${merge}\\^1\\.\\.${merge}`), "a range that shows nothing is a review of nothing");
  assert.equal(h.git(lane.worktree!, "diff", "--name-only", `${merge}^1..${merge}`).trim(), "a.txt", "and the range really shows the task's work");

  // A task cut before it committed leaves neither a copy nor a branch, and there is nothing to read.
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "B", goal: "g", acceptance: ["b"], holds: ["b.txt"], ...scope, parallel: true }] });
  const empty = Object.values(h.ledger().tasks).find((entry) => entry.title === "B")!;
  const cutReply = await h.call(lane.lead!, "lead", "cut", { task: empty.id, reason: "wrong shape" });
  assert.equal(cutReply.ok, true, cutReply.text);
  assert.equal(h.git(h.root, "branch", "--list", empty.branch!).trim(), "", "a cut task with no commits of its own leaves no branch behind");
  const nothing = await h.call(lane.lead!, "lead", "start_review", { task: empty.id, focus: "anything?" });
  assert.equal(nothing.ok, false);
  assert.match(nothing.text, /neither a merge nor a branch is left to read it from/);
});
