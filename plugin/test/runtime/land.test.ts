import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../../server/desk/project.ts";
import { settle } from "./fake-timeline.ts";
import { harness, laneWithPeer } from "./harness.ts";
import { laneWith, risky } from "./landable.ts";

test("a lane touching nothing the Human asked to be asked about first lands at once, with what the desk read of it as evidence", async () => {
  const { land, onMain } = await laneWith(risky);
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.ok(onMain("src/auth/login.ts"), "a path v2 counted as risky is no reason to wait unless the Human says so");
  assert.match(
    landed.text,
    /Evidence: 1 commit; 1 file, 1 line changed\. Gate: passed on the lane\. No review of the whole lane is on record\./,
  );
});

test("an open incident on a lane is evidence for whoever lands it, and never reaches the Lead it may be about", async () => {
  // Beside others, so the lane can report ready with it handed back and not accepted: a task in the lane's copy could not.
  const { h, sup, lane, peer, timeline } = await laneWithPeer({ attention: { watch: true } }, undefined, {
    holds: ["a.txt"],
    parallel: true,
  });
  await h.call(sup, "supervisor", "set_project", { gate: "npm test", gateOn: "lane" });
  const worktree = h.ledger().tasks["L1-T1"]!.worktree!;
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  timeline.add(
    {
      type: "tool_call",
      callId: "w1",
      name: "Edit",
      status: "completed",
      detail: { type: "edit", filePath: join(worktree, "a.txt"), oldString: "one", newString: "uno" },
    },
    "t1",
  );
  timeline.add(
    {
      type: "tool_call",
      callId: "g1",
      name: "Bash",
      status: "completed",
      detail: { type: "shell", command: "npm test", output: "1 failing", exitCode: 1 },
    },
    "t1",
  );
  await settle();
  assert.equal(
    (await h.call(peer, "peer", "done", { outcome: "complete", summary: "done", checks: "npm test passes" })).ok,
    true,
  );
  timeline.beat("turn_completed", "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await h.idle(peer);
  await h.idle(lane.lead!);
  assert.match(
    h.agents.get(lane.lead!)!.sent.join("\n"),
    /INCIDENT I\d+ \(claim-contradicted, attend\) on the Peer on L1-T1[^]*handed back as complete, but `npm test` failed the last time it ran, after the last edit/,
  );
  const reported = await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  assert.doesNotMatch(
    reported.text,
    /Incident|claim-contradicted/,
    "what reaches the Lead of its lane's record leaves incidents out",
  );
  assert.match(
    h.heard(sup).join("\n"),
    /REPORT L1 \(Build\): ready to land[^]*- Incident I\d+ on this lane is still open: claim-contradicted\./,
  );
  const landed = await h.call(sup, "supervisor", "land_lane", {
    lane: "L1",
    overGate: true,
    reason: "the Supervisor judged the red gate safe",
  });
  assert.equal(landed.ok, true, landed.text);
  assert.match(landed.text, /Incident I\d+ on this lane is still open: claim-contradicted\./);
});

test("a READY stands until the lane is amended: status says so, and the Lead must report again", async () => {
  const { h, sup, lane } = await laneWith({ "a.txt": "one\nfour\n" });
  assert.equal((await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true })).ok, true);
  assert.ok(h.ledger().lanes.L1!.ready);
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /Reported ready \d+ min ago\./);
  await h.call(sup, "supervisor", "amend_lane", {
    lane: "L1",
    acceptance: ["four", "five"],
    why: "the Human added five",
  });
  assert.equal(h.ledger().lanes.L1!.ready, undefined, "what it was ready against has changed");
  assert.doesNotMatch((await h.call(sup, "supervisor", "status", {})).text, /Reported ready/);
});

test("a lane its Lead has not reported ready as it now stands lands on the Supervisor's word, with that in the evidence", async () => {
  const { h, sup, land } = await laneWith({ "a.txt": "one\nfour\n" });
  await h.call(sup, "supervisor", "amend_lane", { lane: "L1", acceptance: ["a", "b"], why: "the Human added b" });
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.match(
    landed.text,
    /Evidence: Its Lead has not reported it ready as it now stands: never, or the lane was amended since\. 1 commit/,
  );
  assert.match(h.git(h.root, "show", "main:a.txt"), /four/);
});

test("a lane is landed over a red gate only with the Supervisor's reason for it", async () => {
  const { h, sup } = await laneWith({ "a.txt": "one\nfour\n" });
  await h.call(sup, "supervisor", "set_project", { gate: "false" });
  const bare = await h.call(sup, "supervisor", "land_lane", { lane: "L1", overGate: true });
  assert.equal(bare.ok, false);
  assert.match(bare.text, /needs its reason/);
  assert.equal(h.git(h.root, "show", "main:a.txt"), "one\ntwo\nthree\n", "main is as it was");
  const said = await h.call(sup, "supervisor", "land_lane", {
    lane: "L1",
    overGate: true,
    reason: "the failing test is the flaky one already on main",
  });
  assert.equal(said.ok, true, said.text);
  assert.equal(h.git(h.root, "show", "main:a.txt"), "one\nfour\n");
});

test("a lane asked to carry on the Human's branch works on it where it is, keeps their uncommitted work, and lands by its gate alone", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "test ! -f BROKEN" });
  h.git(h.root, "switch", "-qc", "fix/login");
  h.commit(h.root, "a.txt", "one\ntwo\nthree\nhalf a fix\n");
  writeFileSync(join(h.root, "b.txt"), "bee, still being edited\n");
  const main = h.git(h.root, "rev-parse", "main").trim();
  const scope = {
    outcome: "the login fix is finished",
    acceptance: ["a"],
    outOfScope: ["anything else in the repository"],
  };

  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Finish the fix", ...scope, onBranch: true });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  assert.equal(lane.branch, "fix/login", "no lane branch of its own");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "fix/login");
  assert.deepEqual(h.git(h.root, "branch", "--format=%(refname:short)").trim().split("\n").sort(), [
    "fix/login",
    "main",
  ]);
  assert.equal(
    readFileSync(join(h.root, "b.txt"), "utf-8"),
    "bee, still being edited\n",
    "the Human's uncommitted edit is where they left it",
  );
  assert.equal(h.agents.get(lane.lead!)!.cwd, h.project.root);
  assert.match(
    h.agents.get(lane.lead!)!.prompt ?? "",
    /fix\/login, the Human's own[\s\S]*have the first task working there commit it as found, in a commit of its own/,
    "the Human's work in progress stays theirs, apart from the lane's",
  );
  assert.notEqual(loadConfig(h.project.state).base, "fix/login", "a branch carried on is not made the project's base");

  const second = await h.call(sup, "supervisor", "open_lane", { title: "Also here", ...scope, onBranch: true });
  assert.equal(second.ok, false, "one checkout holds one branch, and L1 has it");
  assert.match(second.text, /L1/);

  h.commit(h.root, "b.txt", "bee, done\n");
  // What the branch held before the lane is the Human's own, so only the lane's commit is asked about.
  await h.call(sup, "supervisor", "set_project", { askFirst: ["a.txt", "b.txt"] });
  const held = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.match(
    held.text,
    /waits for the Human's approval, on the Flow tab of the panel\. It changes b\.txt, under b\.txt, which the Human asked to be asked about first\.\n/,
  );
  await h.call(sup, "supervisor", "set_project", { askFirst: [] });
  const closed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(closed.ok, true, closed.text);
  assert.match(closed.text, /the work stays on fix\/login, the branch it carried on; nothing was merged anywhere/);
  assert.equal(h.git(h.root, "rev-parse", "main").trim(), main, "nothing was merged into main");
  assert.equal(
    h.git(h.root, "branch", "--show-current").trim(),
    "fix/login",
    "and the Human's copy was not switched away",
  );
  assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, done\n");
});

test("a lane that reaches a risk rule is rehearsed with its gate, and a red rehearsal is a red gate the Supervisor may land over", async () => {
  const { h, sup, lane, land, onMain } = await laneWith({ "src/db/001.sql": "create table t (id int);\n" });
  const rule = (paths: string[]) => ({
    paths,
    invariant: "running it twice changes nothing",
    reviewQuestion: "What does a second run do?",
    rehearse: "false",
  });
  const ready = async () => {
    await h.call(lane.lead!, "lead", "report", { summary: `ready ${Date.now()}`, ready: true });
    await h.idle(sup);
    return h
      .heard(sup)
      .filter((text) => text.startsWith("REPORT"))
      .at(-1)!;
  };
  await h.call(sup, "supervisor", "set_project", { riskRules: [rule(["migrations"])] });
  assert.doesNotMatch(await ready(), /rehearsing/, "a rule the lane's change does not reach is not rehearsed");
  await h.call(sup, "supervisor", "set_project", { riskRules: [rule(["src/db"])] });
  assert.match(
    await ready(),
    /Gate: true passed on the lane branch in \d+s\n\nfalse, rehearsing that running it twice changes nothing, failed with exit 1 on the lane branch\./,
  );
  const refused = await land();
  assert.equal(refused.ok, false);
  assert.match(
    refused.text,
    /false, rehearsing that running it twice changes nothing, failed with exit 1[^]*land_lane it over the gate with overGate true and your reason/,
  );
  const over = await h.call(sup, "supervisor", "land_lane", {
    lane: "L1",
    overGate: true,
    reason: "the rehearsal is known broken",
  });
  assert.equal(over.ok, true, over.text);
  assert.ok(onMain("src/db/001.sql"));
});

test("two lanes landed at once each stay on the base: a landing never erases another", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  for (const [title, file] of [
    ["Cart", "cart.txt"],
    ["Order", "order.txt"],
  ] as const) {
    const opened = await h.call(sup, "supervisor", "open_lane", {
      title,
      outcome: title,
      acceptance: ["a"],
      outOfScope: ["the rest"],
      writeSet: [file],
      isolate: true,
    });
    assert.equal(opened.ok, true, opened.text);
    const lane = Object.values(h.ledger().lanes).find((entry) => entry.title === title)!;
    writeFileSync(join(lane.worktree!, file), `${title}\n`);
    h.git(lane.worktree!, "add", "-A");
    h.git(lane.worktree!, "commit", "-qm", title);
    await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
    h.agents.get(lane.lead!)!.status = "idle";
  }
  // The Human works on a branch of their own, so the base is checked out nowhere and moves by its ref alone.
  h.git(h.root, "switch", "-qc", "human-work");
  const replies = await Promise.all(["L1", "L2"].map((lane) => h.call(sup, "supervisor", "land_lane", { lane })));
  const onMain = h.git(h.root, "ls-tree", "--name-only", "-r", "main").split("\n");
  assert.deepEqual(
    replies.map((reply) => reply.ok),
    [true, true],
    "the second waits for the first, then brings in what it landed: " + replies.map((reply) => reply.text).join("\n"),
  );
  assert.deepEqual(
    ["cart.txt", "order.txt"].filter((file) => onMain.includes(file)),
    ["cart.txt", "order.txt"],
    "and main has the work of both",
  );
});

test("landing a lane names the unfinished tasks it would cut before it lands, and the ones it cut, but not a review that gave its verdict", async () => {
  const { h, sup, lane } = await laneWithPeer(undefined, undefined, { holds: ["a.txt"], parallel: true });
  await h.call(lane.lead!, "lead", "start_review", { focus: "the lane as a whole" });
  const review = Object.values(h.ledger().tasks).find((task) => task.kind === "review")!;
  await h.call(review.peer!, "reviewer", "done", { verdict: "accept", answer: "Right." });
  await h.call(lane.lead!, "lead", "report", { summary: "the rest can wait", ready: true });
  await h.idle(sup);
  assert.match(h.heard(sup).join("\n"), /L1-T1 is running: landing cuts it\./);
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(landed.ok, true, landed.text);
  assert.match(landed.text, /It cut L1-T1, which was not finished\./);
  assert.doesNotMatch(h.heard(sup).join("\n"), /L1-R1 is/, "a review that gave its verdict is done");
});
