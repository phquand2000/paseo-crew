import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../../server/desk/project.ts";
import { tempDir } from "../tempdir.ts";
import { harness, ideCalls } from "./harness.ts";

test("a lane works serially in the project's own copy and hands it back on its base branch", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "test ! -f BROKEN", gateOn: "lane" });
  const noLimits = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"] });
  assert.equal(noLimits.ok, false);
  assert.match(noLimits.text, /needs outOfScope/);

  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else in the repository"] });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  const slot = { path: h.project.root };
  assert.deepEqual(Object.keys(h.ledger().slots), [], "a lane opened without isolate takes the project's own copy, not a new one");
  assert.equal(h.agents.get(lane.lead!)!.cwd, slot.path);
  assert.equal(h.git(slot.path, "branch", "--show-current").trim(), lane.branch);
  assert.deepEqual(ideCalls.filter((call) => call.path === slot.path), [
    { kind: "open", path: slot.path },
    { kind: "sync", path: slot.path },
  ]);
  assert.match(h.git(h.root, "rev-parse", "--git-path", "info/exclude").trim() && readFileSync(join(h.root, ".git", "info", "exclude"), "utf-8"), /^\.idea\/$/m);
  assert.equal(h.git(slot.path, "status", "--porcelain"), "");

  const unbounded = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add four", goal: "g", acceptance: ["a"], hints: ["a.txt"] }] });
  assert.equal(unbounded.ok, false);
  assert.match(unbounded.text, /needs outOfScope/);

  const t1 = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add four", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  assert.equal(t1.ok, true, t1.text);
  const task1 = h.ledger().tasks["L1-T1"]!;
  assert.equal(h.agents.get(task1.peer!)!.cwd, slot.path);
  assert.match(task1.branch!, /^task\/l1-t1-/);
  assert.equal(h.git(slot.path, "branch", "--show-current").trim(), task1.branch, "it writes on a branch of its own in the lane's copy");
  const blocked = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "More", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  assert.equal(blocked.ok, true, blocked.text);
  assert.match(blocked.text, /L1-T2 More: held: L1-T1 is still writing in the lane's working copy, and it holds one writer at a time/);
  assert.equal(h.ledger().tasks["L1-T2"]!.peer, undefined, "nobody is sent into the copy beside it");
  assert.equal((await h.call(lane.lead!, "lead", "cut", { task: "L1-T2", reason: "not now" })).ok, true);

  writeFileSync(join(slot.path, "a.txt"), "one\ntwo\nthree\nfour\n");
  assert.equal((await h.call(task1.peer!, "peer", "done", { outcome: "complete", summary: "four" })).ok, true);
  h.agents.get(task1.peer!)!.status = "idle";
  const dirty = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(dirty.ok, false);
  assert.match(dirty.text, /uncommitted/);
  h.git(slot.path, "commit", "-qam", "add four");
  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(accepted.ok, true, accepted.text);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.equal(h.agents.get(task1.peer!)!.archivedAt, null, "its Peer stays in the copy for the next task");

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Break it", goal: "g", acceptance: ["a"], hints: ["BROKEN"], outOfScope: ["the rest of the repository"] }] });
  const task2 = h.ledger().tasks["L1-T3"]!;
  h.commit(slot.path, "BROKEN", "x\n");
  const cut = await h.call(lane.lead!, "lead", "cut", { task: "L1-T3", reason: "wrong" });
  assert.equal(cut.ok, true, cut.text);
  assert.equal(existsSync(join(slot.path, "BROKEN")), false);
  assert.ok(h.agents.get(task2.peer!)!.archivedAt);

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Late break", goal: "g", acceptance: ["a"], hints: ["BROKEN"], outOfScope: ["the rest of the repository"] }] });
  const task3 = h.ledger().tasks["L1-T4"]!;
  h.commit(slot.path, "BROKEN", "late\n");
  await h.call(task3.peer!, "peer", "done", { outcome: "complete", summary: "late" });
  h.agents.get(task3.peer!)!.status = "idle";
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T4" });
  // A red gate is evidence carried in the report, not a gag on the Lead: acceptance is the Lead's to claim and the Supervisor's to judge.
  const onRed = await h.call(lane.lead!, "lead", "report", { summary: "the lane is done", ready: true });
  assert.equal(onRed.ok, true, onRed.text);
  h.git(slot.path, "rm", "-q", "BROKEN");
  h.git(slot.path, "commit", "-qm", "unbreak");
  assert.equal((await h.call(lane.lead!, "lead", "report", { summary: "done, and green this time", ready: true })).ok, true);
  await h.idle(sup);
  const reports = h.agents.get(sup)!.sent.join("\n");
  assert.match(reports, /Gate: .*failed with exit/, "the red gate has to reach the Supervisor, not stop the Lead from speaking");
  assert.match(reports, /Gate: .*passed on the lane branch/);

  const closed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(closed.ok, true, closed.text);
  assert.equal(h.git(h.root, "show", "main:a.txt"), "one\ntwo\nthree\nfour\n");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), lane.branch, "the Lead is mid-turn, and switching the copy under it would put its next commit on main");
  assert.match(closed.text, /The project's own copy goes back to main once/);
  h.agents.get(lane.lead!)!.status = "idle";
  await h.endTurn(lane.lead!, "closing up");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main", "once the Lead stops, the project's copy is back on its base branch");
  assert.equal(h.git(h.root, "branch", "--list", lane.branch).trim(), "", "and the landed branch goes, its commits kept under the lane's ref");
  assert.equal(h.git(h.root, "log", "-1", "--format=%B", "main").trim(), [`${lane.title} (L1)`, "", lane.outcome, "", "- L1-T1 " + h.ledger().tasks["L1-T1"]!.title, "- L1-T4 Late break"].join("\n"), "one commit, naming the tasks that went in and not the one cut");

  const reopened = await h.call(sup, "supervisor", "open_lane", { title: "Next", outcome: "b.txt changes", acceptance: ["z"], outOfScope: ["anything else in the repository"] });
  assert.equal(reopened.ok, true, reopened.text);
  assert.equal(h.ledger().lanes.L2!.slot, undefined, "the next lane works in place too, so nothing is created to reuse");
  assert.equal(h.workspaces.size, 1);
  assert.deepEqual(ideCalls.filter((call) => call.path === slot.path).map((call) => call.kind), ["open", "sync", "open", "sync"]);
  assert.equal(h.git(slot.path, "branch", "--show-current").trim(), h.ledger().lanes.L2!.branch);
});

test("a copy the desk opened in the index is closed there when the copy goes, and the project's own never is", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Away", outcome: "b.txt changes", acceptance: ["a"], isolate: true, ...scope });
  const lane = h.ledger().lanes.L1!;
  const copy = h.ledger().slots[lane.slot!]!.path;
  assert.deepEqual(ideCalls.filter((call) => call.path === copy).map((call) => call.kind), ["open"]);

  h.agents.get(lane.lead!)!.status = "idle";
  const closed = await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "done" });
  assert.equal(closed.ok, true, closed.text);
  assert.equal((await h.call(sup, "supervisor", "release", { lane: "L1" })).ok, true, "the copy goes with its kept Lead");
  // Every copy the IDE was handed stayed open in a window of its own, one per lane that ever ran.
  assert.deepEqual(ideCalls.filter((call) => call.path === copy).map((call) => call.kind), ["open", "close"], "the window goes with the copy");
  assert.equal(ideCalls.some((call) => call.kind === "close" && call.path === h.root), false, "the Human's own project stays open");
});

test("a lane that fails after taking the project's own copy gives it back", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const before = h.git(h.project.root, "branch", "--show-current").trim();

  // Refused after `inPlace` switched the owner's checkout; openLane's cleanup by slot id used to leave it moved.
  const refused = await h.call(sup, "supervisor", "open_lane", {
    title: "Numbers",
    outcome: "a.txt gains words",
    acceptance: ["four"],
    outOfScope: ["anything else in the repository"],
    role: "peer",
  });
  assert.equal(refused.ok, false, refused.text);
  const lane = h.ledger().lanes.L1!;
  assert.equal(lane.status, "closed");
  assert.equal(h.git(h.project.root, "branch", "--show-current").trim(), before, "the owner's repository is back where it was");
  assert.equal(h.git(h.project.root, "branch", "--list", lane.branch).trim(), "", "and the branch the lane made, which holds nothing, is gone");

  // The first attempt left the project's workspace behind, so the daemon has to fail to find it as well as to make one.
  const workspaces = (h.paseo as unknown as { workspaces: { create: unknown; list: unknown } }).workspaces;
  workspaces.list = workspaces.create = async () => {
    throw new Error("the daemon made no workspace");
  };
  const unhoused = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else in the repository"] });
  assert.equal(unhoused.ok, false, unhoused.text);
  assert.equal(h.git(h.project.root, "branch", "--show-current").trim(), before, "a copy Paseo would not take is handed back too");
  assert.equal(h.git(h.project.root, "branch", "--list", h.ledger().lanes.L2!.branch).trim(), "");
});

test("the Supervisor's status shows the Human's own copy, names a choice only where carrying on is a real question, and what each open lane is for", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { base: "main", gate: "true" });
  const status = async () => (await h.call(sup, "supervisor", "status", {})).text;
  const choice = /The Human decides where the next lane works/;

  const fresh = await status();
  assert.match(fresh, /Base main\.[^\n]*\n\n## The project's own copy\n\n[^\n]* is on main, clean\.\nNo lane is working in it\./, fresh);
  assert.doesNotMatch(fresh, choice, "on the base and clean, a lane just opens");

  h.git(h.root, "switch", "-qc", "fix/login");
  const offBase = await status();
  assert.match(offBase, /is on fix\/login, clean\./);
  assert.match(offBase, choice, "the reported case: a clean branch that is not the base");
  assert.match(offBase, /carry on fix\/login here \(onBranch\), a new branch off main here \(isolate false\), or a copy of its own \(isolate\)\./);

  for (let n = 1; n <= 12; n++) writeFileSync(join(h.root, `wip-${String(n).padStart(2, "0")}.txt`), "half done\n");
  writeFileSync(join(h.root, "a.txt"), "edited\n");
  const dirty = await status();
  assert.match(dirty, /with 13 uncommitted files: a\.txt, wip-01\.txt, [^\n]*wip-09\.txt, and 3 more\./, dirty);
  assert.match(dirty, /takes the uncommitted work along/);

  h.git(h.root, "stash", "-u", "-q");
  h.git(h.root, "switch", "-q", "main");
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"], writeSet: ["a.txt"], contracts: ["b.txt"] });
  assert.equal(opened.ok, true, opened.text);
  const held = await status();
  assert.match(held, /Lane L1 is working in it\./);
  assert.doesNotMatch(held, choice, "a lane holds the copy, so the next one takes a copy of its own");
  assert.match(held, /Outcome: a\.txt gains words\nWrites: a\.txt\nDepends on: b\.txt/);

  const lead = (await h.call(h.ledger().lanes.L1!.lead!, "lead", "status", {})).text;
  assert.doesNotMatch(lead, /The project's own copy|Outcome:/, "a Lead's status is its own lane, as before");
});

test("carrying on a branch is refused where there is none to carry on, and a failed open leaves the Human's branch alone", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  h.git(h.root, "switch", "-qc", "fix/login");

  for (const extra of [{ isolate: true }, { base: "main" }]) {
    const refused = await h.call(sup, "supervisor", "open_lane", { title: "Odd", ...scope, onBranch: true, ...extra });
    assert.equal(refused.ok, false, JSON.stringify(extra));
  }
  const failed = await h.call(sup, "supervisor", "open_lane", { title: "No lead", ...scope, onBranch: true, role: "peer" });
  assert.equal(failed.ok, false, failed.text);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "fix/login", "still on the Human's branch");
  assert.match(h.git(h.root, "branch", "--list", "fix/login"), /fix\/login/, "and it was not deleted");
  assert.deepEqual(h.events("lane.gaveBack"), [], "nor was it ever handed to the undo made for a lane branch");

  writeFileSync(join(h.root, "b.txt"), "bee, half done\n");
  const alone = await h.call(sup, "supervisor", "open_lane", { title: "Alone", ...scope, newBranch: "fix/login-2" });
  assert.match(alone.text, /newBranch goes with onBranch/, "a new branch is only started for a lane that carries it on");
  const taken = await h.call(sup, "supervisor", "open_lane", { title: "Taken", ...scope, onBranch: true, newBranch: "main" });
  assert.equal(taken.ok, false);
  assert.match(taken.text, /main already exists/);
  const unled = await h.call(sup, "supervisor", "open_lane", { title: "No lead", ...scope, onBranch: true, newBranch: "fix/login-2", role: "peer" });
  assert.equal(unled.ok, false, unled.text);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "fix/login", "a branch started for a lane that failed to open is undone");
  assert.equal(h.git(h.root, "branch", "--list", "fix/login-2").trim(), "");
  assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, half done\n", "and the uncommitted work came back with the copy");

  h.git(h.root, "switch", "-q", "--detach");
  const detached = await h.call(sup, "supervisor", "open_lane", { title: "Nowhere", ...scope, onBranch: true });
  assert.equal(detached.ok, false);
  assert.match(detached.text, /not on a branch/);
});

test("a new branch the Human agreed to starts where their copy is, takes their uncommitted work along, and is carried on", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { base: "main" });
  h.git(h.root, "switch", "-qc", "fix/login");
  writeFileSync(join(h.root, "b.txt"), "bee, half done\n");

  const workspaces = (h.paseo as unknown as { workspaces: { create: unknown } }).workspaces;
  const create = workspaces.create;
  workspaces.create = async () => {
    throw new Error("the daemon made no workspace");
  };
  const unhoused = await h.call(sup, "supervisor", "open_lane", { title: "Split off", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], onBranch: true, newBranch: "fix/login-2" });
  workspaces.create = create;
  assert.equal(unhoused.ok, false, unhoused.text);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "fix/login", "a branch started for a copy Paseo would not take is undone");
  assert.equal(h.git(h.root, "branch", "--list", "fix/login-2").trim(), "");
  assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, half done\n");

  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Split off", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], onBranch: true, newBranch: "fix/login-2" });
  assert.equal(opened.ok, true, opened.text);
  const lane = Object.values(h.ledger().lanes).find((entry) => entry.status === "open")!;
  assert.equal(lane.branch, "fix/login-2");
  assert.match((await h.call(sup, "supervisor", "status", {})).text, new RegExp(`## ${lane.id} Split off\\n\\nBranch fix/login-2, carried on in the project's own copy\\.`));
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "fix/login-2");
  assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, half done\n");
  assert.equal(h.git(h.root, "rev-parse", "fix/login").trim(), h.git(h.root, "rev-parse", "fix/login-2").trim(), "the branch it left is where it was");

  const closed = await h.call(sup, "supervisor", "drop_lane", { lane: lane.id, reason: "no longer wanted" });
  assert.equal(closed.ok, true, closed.text);
  assert.equal(h.ledger().lanes[lane.id]!.restoring, undefined, "nothing is left to put back, so no round retries it");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "fix/login-2");
  assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, half done\n");

  h.git(h.root, "switch", "-q", "main");
  const onBase = await h.call(sup, "supervisor", "open_lane", { title: "Straight on main", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], onBranch: true });
  assert.equal(onBase.ok, true, onBase.text);
  assert.match(onBase.text, /carries on main [^,]*, which is the project's base: nothing separates this work from it/, "allowed, and said plainly");
});

test("a lane in the project's own copy whose base moved waits for a seat mid-turn there, then lands", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"] });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  writeFileSync(join(h.project.root, "a.txt"), "one\ntwo\nthree\nfour\n");
  h.git(h.project.root, "add", "-A");
  h.git(h.project.root, "commit", "-qm", "four");

  // main moves on while the lane runs, so landing first merges main into the lane in its own copy.
  const side = join(tempDir("sw2-moved-"), "wt");
  h.git(h.project.root, "worktree", "add", "-q", "-b", "side", side, "main");
  h.git(side, "commit", "-qm", "moved", "--allow-empty");
  h.git(h.project.root, "branch", "-f", "main", "side");
  h.git(h.project.root, "worktree", "remove", "--force", side);

  // Nothing is merged under a Lead mid-turn in that copy.
  const head = h.git(h.root, "rev-parse", "HEAD");
  const reports = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(reports.ok, false, reports.text);
  assert.match(reports.text, /a seat is mid-turn there/);
  assert.equal(h.git(h.root, "rev-parse", "HEAD"), head, "the copy under a running seat is left as the seat has it");
  assert.doesNotMatch(h.git(h.root, "show", "main:a.txt"), /four/);
  // Still open, so the landing waits for the turn rather than being lost with a closed lane.
  assert.equal(h.ledger().lanes.L1!.status, "open");
  h.agents.get(lane.lead!)!.status = "idle";
  // Nothing else brings the Supervisor back to land it.
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /CAN LAND/);
  await h.endTurn(lane.lead!, "reported");
  assert.match(h.agents.get(sup)!.sent.join("\n"), /CAN LAND L1/, "the end of the turn that was in the way is mail for whoever tried to land");
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(landed.ok, true, landed.text);
  assert.match(h.git(h.root, "show", "main:a.txt"), /four/);
});

test("a lane in the project's own copy lands after its base moved, once nobody is writing there", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"] });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  writeFileSync(join(h.project.root, "a.txt"), "one\ntwo\nthree\nfour\n");
  h.git(h.project.root, "add", "-A");
  h.git(h.project.root, "commit", "-qm", "four");
  const side = join(tempDir("sw2-moved-"), "wt");
  h.git(h.project.root, "worktree", "add", "-q", "-b", "side", side, "main");
  h.git(side, "commit", "-qm", "moved", "--allow-empty");
  h.git(h.project.root, "branch", "-f", "main", "side");
  h.git(h.project.root, "worktree", "remove", "--force", side);
  const moved = h.git(h.root, "rev-parse", "main").trim();

  // With the Lead stopped, main is merged into the lane where it stands and lands on main as one commit.
  h.agents.get(lane.lead!)!.status = "idle";
  const closed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(closed.ok, true, closed.text);
  assert.match(h.git(h.root, "show", "main:a.txt"), /four/);
  assert.equal(h.git(h.root, "rev-parse", "main^").trim(), moved);
  assert.equal(h.git(h.root, "log", "-1", "--format=%s", "refs/seatworks/lanes/L1").trim(), `Bring main into ${lane.branch}`);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
  assert.equal(h.git(h.root, "branch", "--list", lane.branch).trim(), "", "a landed branch is all under its landed ref, so it goes");
});

test("a project set to land by merge commit keeps the lane's commits on main under one merge", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const set = await h.call(sup, "supervisor", "set_project", { landAs: "merge" });
  assert.match(set.text, /land as merge/);
  assert.equal(loadConfig(h.project.state).landAs, "merge");
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /Lanes land as merge\./);
  await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  const before = h.git(h.root, "rev-parse", "main").trim();
  writeFileSync(join(h.project.root, "a.txt"), "one\nfour\n");
  h.git(h.project.root, "commit", "-qam", "four");
  const tip = h.git(h.root, "rev-parse", "HEAD").trim();
  h.agents.get(lane.lead!)!.status = "idle";
  const closed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(closed.ok, true, closed.text);
  assert.match(closed.text, /merged lane\/l1-numbers into main/);
  assert.deepEqual(h.git(h.root, "log", "-1", "--format=%P", "main").trim().split(" "), [before, tip]);
});
