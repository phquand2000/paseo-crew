import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mock, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { sentBy } from "../../server/core/sent-by.ts";
import { KEEP_CLOSED_LANES } from "../../server/desk/archive.ts";
import { saveLedger } from "../../server/desk/ledger.ts";
import { loadConfig, projectOf } from "../../server/desk/project.ts";
import { tempDir } from "../tempdir.ts";
import { settle } from "./fake-timeline.ts";
import { type Pending, harness, ideCalls, laneWithPeer, repo } from "./harness.ts";

test("a lane works serially in the project's own copy and hands it back on its base branch", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "test ! -f BROKEN" });
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

  const unbounded = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add four", goal: "g", acceptance: ["a"], owned: ["a.txt"] }] });
  assert.equal(unbounded.ok, false);
  assert.match(unbounded.text, /needs outOfScope/);

  const t1 = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add four", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  assert.equal(t1.ok, true, t1.text);
  const task1 = h.ledger().tasks["L1-T1"]!;
  assert.equal(h.agents.get(task1.peer!)!.cwd, slot.path);
  assert.equal(task1.branch, lane.branch);
  const blocked = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "More", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
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
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.equal(h.agents.get(task1.peer!)!.archivedAt, null, "its Peer stays in the copy for the next task");

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Break it", goal: "g", acceptance: ["a"], owned: ["BROKEN"], outOfScope: ["the rest of the repository"] }] });
  const task2 = h.ledger().tasks["L1-T3"]!;
  h.commit(slot.path, "BROKEN", "x\n");
  const cut = await h.call(lane.lead!, "lead", "cut", { task: "L1-T3", reason: "wrong" });
  assert.equal(cut.ok, true, cut.text);
  assert.equal(existsSync(join(slot.path, "BROKEN")), false);
  assert.ok(h.agents.get(task2.peer!)!.archivedAt);

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Late break", goal: "g", acceptance: ["a"], owned: ["BROKEN"], outOfScope: ["the rest of the repository"] }] });
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
  assert.doesNotMatch(readFileSync(join(h.project.state, "events.log"), "utf-8"), /lane\.gaveBack/, "nor was it ever handed to the undo made for a lane branch");

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

test("a gate the owner switched off is still off when the next lane opens", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  writeFileSync(join(h.project.root, "package.json"), JSON.stringify({ scripts: { test: "echo ran" } }));
  h.git(h.project.root, "add", "-A");
  h.git(h.project.root, "commit", "-qm", "a package");

  assert.match((await h.call(sup, "supervisor", "set_project", { gate: "" })).text, /gate none/);
  // "Switched off" and "never set" used to be one stored value, so the next lane re-detected `npm test`.
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"] });
  assert.equal(opened.ok, true, opened.text);
  assert.match(opened.text, /Gate: none set, by this project's own choice/, opened.text);
  assert.match((await h.call(sup, "supervisor", "set_project", {})).text, /gate none/);
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

test("parallel work needs independent write sets and merges back from its own working copy", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Two files", outcome: "both change", acceptance: ["a", "b"], outOfScope: ["anything else in the repository"], writeSet: ["a.txt", "b.txt"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const overlap = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A again", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"], parallel: true }] });
  assert.equal(overlap.ok, false);
  assert.match(overlap.text, /T owns a\.txt, which L1-T1 is still writing, and does not wait for it/);
  const serial = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Lock", goal: "g", acceptance: ["a"], owned: ["package-lock.json"], outOfScope: ["the rest of the repository"], parallel: true }] });
  assert.equal(serial.ok, false, "the lock file is really in this repository, so a parallel task may not own it");
  const par = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], outOfScope: ["the rest of the repository"], parallel: true }] });
  assert.equal(par.ok, true, par.text);
  const taskB = h.ledger().tasks["L1-T2"]!;
  assert.equal(taskB.slot, "S0", "the lane itself is in place, so the parallel task takes the first working copy the desk makes");
  assert.equal(h.agents.get(taskB.peer!)!.cwd, h.ledger().slots.S0!.path);

  const taskA = h.ledger().tasks["L1-T1"]!;
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(taskA.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(taskA.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);

  h.commit(taskB.worktree!, "b.txt", "B\n");
  await h.call(taskB.peer!, "peer", "done", { outcome: "complete", summary: "b" });
  h.agents.get(taskB.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(h.git(lane.worktree!, "show", "HEAD:b.txt"), "B\n");
  assert.deepEqual(Object.keys(h.ledger().slots), [taskB.slot], "the copy a parallel task opened stays with its Peer once its work is in, until its Lead releases it");

  const clash = await h.call(sup, "supervisor", "open_lane", { title: "C", outcome: "c", acceptance: ["c"], outOfScope: ["anything else in the repository"], writeSet: ["b.txt"] });
  assert.equal(clash.ok, false);
  assert.match(clash.text, /overlaps lane L1/, "two lanes that declared the same file are one lane, whichever copy each of them writes in");
  const fine = await h.call(sup, "supervisor", "open_lane", { title: "C", outcome: "c", acceptance: ["c"], outOfScope: ["anything else in the repository"], writeSet: ["c.txt"], isolate: true });
  assert.equal(fine.ok, true, fine.text);
  assert.ok(h.ledger().lanes.L2!.slot, "L1 is writing in the project's own copy, so the next lane is given one instead of switching the branch under it");
});

test("what the desk sends a seat carries the kinds of its letters in its id, its first prompt too, so the watch tells it from a person's words", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Kinds", outcome: "x", acceptance: ["y"], outOfScope: ["anything else in the repository"] });
  const lead = h.ledger().lanes.L1!.lead!;
  await h.idle(lead);
  await h.call(lead, "lead", "ask", { kind: "question", text: "Round half up or down?", default: "half up" });
  await h.call(sup, "supervisor", "answer", { ask: "A1", text: "Half up." });
  await h.idle(lead);
  assert.deepEqual(sentBy({ clientMessageId: h.agents.get(lead)!.promptId }), ["brief"]);
  assert.deepEqual(sentBy({ clientMessageId: h.agents.get(lead)!.sentIds.at(-1) }), ["answer"]);
});

test("asks reach the level above, answers come back, and a silent Peer is nudged then reported", async () => {
  const h = harness();
  const turnEnded = h.endTurn;
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Asks", outcome: "x", acceptance: ["y"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.idle(lane.lead!);

  const asked = await h.call(lane.lead!, "lead", "ask", { kind: "question", text: "Round half up or down?", default: "half up" });
  assert.equal(asked.ok, true, asked.text);
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.at(-1)!, /ASK A1 \(question\)[\s\S]*half up/);
  assert.equal((await h.call(sup, "supervisor", "answer", { ask: "A1", text: "Half up." })).ok, true);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /ANSWER to your ask A1[\s\S]*Half up/);

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Quiet one", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;
  await new Promise((resolve) => setTimeout(resolve, 5));
  h.agents.get(task.peer!)!.status = "idle";
  await turnEnded(task.peer!, "I looked around.");
  await h.runtime.outbox.pump(task.peer!);
  assert.match(h.agents.get(task.peer!)!.sent.at(-1)!, /without calling done or ask/);
  h.runtime.outbox.turnEnded(task.peer!);
  await turnEnded(task.peer!, "Still looking.");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  h.agents.get(lane.lead!)!.status = "idle";
  h.runtime.outbox.turnEnded(lane.lead!);
  await h.runtime.outbox.pump(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /SILENT L1-T1[\s\S]*Still looking/);
});

test("a working Peer past the first page of agents is not read as gone", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  // A long-lived daemon: plenty of other agents, more recently active than the Peer about to start.
  for (let index = 0; index < 205; index++) h.add("sw2-supervisor-claude/claude-opus-5", h.root, `other-${index}`);

  await h.call(sup, "supervisor", "open_lane", { title: "Busy machine", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;
  assert.equal(h.agents.size > 200, true, "the seats this lane needs are past the first page");

  await h.tick(Date.now());
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "a seat the desk cannot see on one page is not a seat that is gone");
  await h.idle(lane.lead!);
  assert.doesNotMatch(h.agents.get(lane.lead!)!.sent.join("\n"), /was closed or archived/, "and its Lead is not told a working Peer was closed");
  assert.equal(task.peer !== undefined, true);
});

test("a call that runs longer than a seat can wait is answered by mail, and calling it again does not run it twice", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "sleep 1" });
  await h.call(sup, "supervisor", "open_lane", { title: "Slow", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  const request = { id: "r1", agent: lane.lead!, role: "lead", tool: "report", args: { summary: "ready to land", ready: true }, cwd: h.root, at: Date.now() };

  // The bridge waits five minutes but the gate thirty, so a retried call must not start a second gate.
  const [first, again] = await Promise.all([h.runtime.desk.answer(request, 100), h.runtime.desk.answer({ ...request, id: "r2" }, 100)]);
  assert.match(first.text, /still working on report/);
  assert.match(again.text, /already running/);
  await Promise.all([...(h.runtime.desk as unknown as { running: Map<string, { reply: Promise<unknown> }> }).running.values()].map((entry) => entry.reply));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(readdirSync(join(h.project.state, "gates")).filter((name) => name.startsWith("L1-")).length, 1, "one gate ran, not two");
  await h.idle(lane.lead!);
  const told = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.equal(told.split("ANSWER to your report call").length - 1, 1, "and the answer came once, as mail");
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /REPORT L1/);
});

test("a hand-back whose gate outlasts the call is not read as a silent turn", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "sleep 1", gateOn: "task" });
  await h.call(sup, "supervisor", "open_lane", { title: "Slow", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.commit(lane.worktree!, "a.txt", "A\n");

  // Past what a call can wait, the Peer is told to end its turn; that turn must not read as one that never called done.
  h.beginTurn(peer);
  const reply = await h.runtime.desk.answer({ id: "d1", agent: peer, role: "peer", tool: "done", args: { outcome: "complete", summary: "done" }, cwd: h.root, at: Date.now() }, 100);
  assert.match(reply.text, /still working on done/);
  h.agents.get(peer)!.status = "idle";
  await h.endTurn(peer, "handed back, ending my turn as told");
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 0, "a call still being worked on is not silence");
  assert.doesNotMatch(h.agents.get(peer)!.sent.join("\n"), /without calling done or ask/);

  await Promise.all([...(h.runtime.desk as unknown as { running: Map<string, { reply: Promise<unknown> }> }).running.values()].map((entry) => entry.reply));
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "done");
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /Gate: sleep 1 passed/);
});

test("a task stalled because its Peer is gone holds no copy, and an ask to a gone reader goes to whoever supervises now", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Gone", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  Object.assign(h.agents.get(peer)!, { archivedAt: new Date().toISOString(), status: "closed" });
  await h.tick(Date.now());
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");

  // Nobody writes in the copy any more, so the Lead must not be told to wait for a hand-back.
  const next = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "More", goal: "g", acceptance: ["b"], owned: ["b.txt"], outOfScope: ["the rest of the repository"] }] });
  assert.equal(next.ok, true, next.text);

  // A Lead's ask to a Supervisor that has since gone must reach the one who sits down afterwards.
  assert.equal((await h.call(lane.lead!, "lead", "ask", { kind: "question", text: "Keep the old endpoint?", default: "keep it" })).ok, true);
  Object.assign(h.agents.get(sup)!, { archivedAt: new Date().toISOString(), status: "closed" });
  const back = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup-2");
  await h.tick(Date.now() + 16 * 60_000);
  await h.idle(back);
  assert.match(h.agents.get(back)!.sent.join("\n"), /Keep the old endpoint\?/);
  assert.equal(Object.values(h.ledger().asks).find((ask) => ask.text.startsWith("Keep the old endpoint"))!.to, back);
});

test("an escalation with nobody supervising seated waits for one instead of being marked sent", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Asks", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  assert.equal((await h.call(peer, "peer", "ask", { question: "Round half up or down?", tried: "read the spec", bestGuess: "half up" })).ok, true);
  h.agents.get(lane.lead!)!.status = "idle";
  Object.assign(h.agents.get(sup)!, { archivedAt: new Date().toISOString(), status: "closed" });

  // With the only Supervisor archived there is nobody to escalate to, so it must not be marked escalated.
  const start = Date.now();
  for (const minutes of [16, 32, 48]) await h.tick(start + minutes * 60_000);
  const ask = Object.values(h.ledger().asks)[0]!;
  assert.equal(ask.escalated ?? false, false, "nobody received it, so it is not recorded as escalated");

  const back = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup-2");
  await h.tick(start + 64 * 60_000);
  await h.idle(back);
  assert.equal(Object.values(h.ledger().asks)[0]!.escalated, true);
  assert.match(h.agents.get(back)!.sent.join("\n"), /Round half up or down\?\n\nTried: read the spec\n\nTheir default: half up/, "and the Supervisor who came back is the one told, the Peer's best guess with it");
});

test("a stalled task still holds its working copy, and runs again once its Peer is heard from", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Quiet", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.agents.get(peer)!.status = "idle";
  for (const text of ["reading", "still reading"]) {
    h.runtime.outbox.turnEnded(peer);
    await new Promise((resolve) => setTimeout(resolve, 3));
    h.beginTurn(peer);
    await h.endTurn(peer, text);
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  assert.match(h.agents.get(peer)!.prompt ?? "", /Your task started from [0-9a-f]{40}/, "the brief names where the task began, which is BASE for its checks");

  // Its Peer is still seated in the lane's copy, so a stalled task still holds it.
  const second = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "More", goal: "g", acceptance: ["b"], owned: ["b.txt"], outOfScope: ["the rest of the repository"] }] });
  assert.match(second.text, /L1-T2 More: held: L1-T1 is still writing/);
  assert.equal(h.ledger().tasks["L1-T2"]!.peer, undefined);

  // Working again, it is running, so the patrol's gone-Peer and idle-lane checks see it.
  h.runtime.outbox.turnEnded(peer);
  await new Promise((resolve) => setTimeout(resolve, 3));
  h.beginTurn(peer);
  assert.equal((await h.call(peer, "peer", "ask", { question: "Which file first?", tried: "read both", bestGuess: "the one the test names" })).ok, true);
  await h.endTurn(peer, "asked");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running");
});

test("a Peer that asked is not stalled on its next quiet turn, and a repeated rework is not called sent", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Quiet", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;
  const peer = task.peer!;

  h.agents.get(peer)!.status = "idle";
  h.beginTurn(peer);
  await h.endTurn(peer, "still reading");
  await h.runtime.outbox.pump(peer);
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 1);
  assert.match(h.agents.get(peer)!.sent.at(-1)!, /without calling done or ask/);

  // Real turns are seconds apart, so the test waits for the desk's millisecond turn clock to move.
  h.runtime.outbox.turnEnded(peer);
  await new Promise((resolve) => setTimeout(resolve, 3));
  h.beginTurn(peer);
  assert.equal((await h.call(peer, "peer", "ask", { question: "Round half up or down?", tried: "read the spec", bestGuess: "half up" })).ok, true);
  await h.endTurn(peer, "asked and waiting");
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 0, "the count is of consecutive quiet turns, not a lifetime tally");

  h.runtime.outbox.turnEnded(peer);
  await new Promise((resolve) => setTimeout(resolve, 3));
  h.beginTurn(peer);
  await h.endTurn(peer, "applying it");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "a Peer that asked in between has not gone silent twice");
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 1);

  // The same instruction twice: letters are keyed by the event, so the second one really goes.
  const first = await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "Commit your work." });
  assert.equal(first.ok, true, first.text);
  const again = await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "Commit your work." });
  assert.equal(again.ok, true, "a Lead repeating itself is a second instruction, not a double post");
  h.runtime.outbox.turnEnded(peer);
  await h.runtime.outbox.pump(peer);
  const told = h.agents.get(peer)!.sent.join("\n");
  assert.equal(told.match(/Commit your work/g)?.length, 2, "both went; keyed by its words, the second was dropped and the Lead was told it was sent");
});

test("each project gets the agent and model its own settings choose, and the machine layer keeps the rest", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  await h.call(sup, "supervisor", "open_lane", { title: "Defaults", outcome: "a.txt changes", acceptance: ["one"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Default peer", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const onDefaults = h.agents.get(h.ledger().tasks["L1-T1"]!.peer!)!.provider;
  assert.equal(onDefaults, "sw2-peer-claude/claude-opus-5");
  assert.equal(h.agents.get(lane.lead!)!.provider, "sw2-lead-claude/claude-opus-5");

  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ roles: { peer: { harness: "pi", model: "glm-5" } } }));
  await h.call(h.ledger().tasks["L1-T1"]!.peer!, "peer", "done", { outcome: "complete", summary: "done" });
  h.commit(h.root, "a.txt", "one\n");
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Pi peer", goal: "g", acceptance: ["a"], owned: ["b.txt"], outOfScope: ["the rest of the repository"] }] });
  const switched = h.agents.get(h.ledger().tasks["L1-T2"]!.peer!)!.provider;
  assert.equal(switched, "sw2-peer-pi/glm-5");
  assert.equal(h.agents.get(lane.lead!)!.provider, "sw2-lead-claude/claude-opus-5");
});

test("what the desk opened and nothing holds any more is swept away without being asked", async () => {
  const h = harness();
  const tick = h.tick;
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Swept", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });

  const ws = h.paseo as unknown as { workspaces: { create(options: { title: string; source: { kind: string; path: string } }): Promise<{ id: string }> } };
  const orphan = await ws.workspaces.create({ title: `${h.project.slug} S9`, source: { kind: "directory", path: h.root } });
  const inPlace = [...h.workspaceNames.entries()].find(([, name]) => name === h.project.slug)![0];
  assert.equal(h.archivedWorkspaces.has(orphan.id), false, "the orphan starts out live");

  await tick();

  assert.equal(h.archivedWorkspaces.has(orphan.id), true, "a working copy the ledger no longer holds is put away by the desk, not by a human with a shell");
  assert.equal(h.archivedWorkspaces.has(inPlace), false, "the copy the open lane is working in is left alone");
});

test("one workspace carries a whole project, and the desk puts it away when the project goes quiet", async () => {
  const h = harness();
  const tick = h.tick;
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Quiet", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;

  const live = () =>
    [...h.workspaceNames.entries()].filter(([id, name]) => (name === h.project.slug || name.startsWith(`${h.project.slug} `)) && !h.archivedWorkspaces.has(id));
  assert.equal(live().length, 1, "a lane takes the project's one working copy rather than opening one of its own");

  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "done" });
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  h.agents.get(sup)!.archivedAt = new Date().toISOString();
  await tick();

  assert.equal(live().length, 0, "with the work finished and nobody seated, the desk takes back what it opened instead of leaving it for a human to delete");
});

test("a project removed while the plugin runs is not written back by the round", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.tick(Date.now());
  assert.ok(existsSync(join(h.project.state, "status.md")), "a project on record has its status page");
  // Its seats gone: a live one is a project still in use, and seeing it records the project again.
  h.agents.get(sup)!.archivedAt = new Date().toISOString();
  rmSync(h.project.state, { recursive: true, force: true });
  await h.tick(Date.now());
  assert.equal(existsSync(h.project.state), false, "the Human removed it, and the round leaves it removed");
});

test("a lane that declared no write set does not lock the project to one lane, and where the next one works is the Supervisor's call", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };

  // The first lane is allowed to open with no write set, and takes the project's own copy.
  const first = await h.call(sup, "supervisor", "open_lane", { title: "Authorization", outcome: "roles gate the api", acceptance: ["a"], ...scope });
  assert.equal(first.ok, true, first.text);

  // One checkout is one branch: the desk names both ways and takes neither for the Supervisor.
  const asked = { title: "Authentication", outcome: "sessions exist", acceptance: ["a"], writeSet: ["src/auth/**"], ...scope };
  const refused = await h.call(sup, "supervisor", "open_lane", asked);
  assert.match(refused.text, /Lane L1 is working in the project's own copy on lane\/l1-authorization\. Pass isolate to open this lane in a copy of its own now, or open it with after L1/);
  assert.equal(Object.keys(h.ledger().lanes).length, 1, "nothing is recorded for a lane that did not open");
  const next = await h.call(sup, "supervisor", "open_lane", { ...asked, isolate: true });
  assert.equal(next.ok, true, next.text);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), h.ledger().lanes.L1!.branch, "the project's own copy stays on the lane it is carrying");

  // The DETOUR of the concept: a hole found mid-lane gets its own Lead, and a copy of its own without asking, since it cannot wait.
  const detour = await h.call(sup, "supervisor", "open_lane", { title: "Sessions", outcome: "sessions last a day", acceptance: ["a"], detourOf: "L1", ...scope });
  assert.equal(detour.ok, true, detour.text);
  const lanes = h.ledger().lanes;
  assert.equal(Object.values(lanes).filter((lane) => lane.status === "open").length, 3);
  const where = [lanes.L1!, lanes.L2!, lanes.L3!].map((lane) => h.agents.get(lane.lead!)!.cwd);
  assert.equal(new Set(where).size, 3, "no two Leads are left writing in one checkout");
});

test("a lane's own working copy is filed under the project, so closing it leaves no project behind", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Here", outcome: "a.txt changes", acceptance: ["a"], ...scope });
  const away = await h.call(sup, "supervisor", "open_lane", { title: "Away", outcome: "b.txt changes", acceptance: ["a"], isolate: true, ...scope });
  assert.equal(away.ok, true, away.text);

  const { L1, L2 } = h.ledger().lanes;
  assert.notEqual(h.workspaces.get(L2!.workspaceId!), h.root, "the second lane works in a copy of its own");
  // Nothing the plugin can call removes a Paseo project, so a copy must join the project it came from.
  assert.equal(h.workspaceProjects.get(L2!.workspaceId!), h.workspaceProjects.get(L1!.workspaceId!), "the copy belongs to the project it was taken from");
});

test("a working copy is not handed to Paseo bare when the project's workspace names no project", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Here", outcome: "a.txt changes", acceptance: ["a"], ...scope });
  h.workspaceProjects.set(h.ledger().lanes.L1!.workspaceId!, "");
  const made = h.workspaces.size;

  const away = await h.call(sup, "supervisor", "open_lane", { title: "Away", outcome: "b.txt changes", acceptance: ["a"], isolate: true, ...scope });
  assert.equal(away.ok, false);
  assert.match(away.text, /names no Paseo project/);
  assert.equal(h.workspaces.size, made, "no workspace, and so no project, was made for the copy");
});

test("a ledger the desk cannot read is not written over, and the seat is told why", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Real work", outcome: "x", acceptance: ["a"], ...scope });
  assert.ok(h.ledger().lanes.L1, "there is something on record to lose");

  // Whatever wrote it, an unreadable ledger must not read like a project that has not started.
  const file = join(h.project.state, "ledger.json");
  const kept = '{ "lanes": ';
  writeFileSync(file, kept);

  const refused = await h.call(sup, "supervisor", "open_lane", { title: "After", outcome: "y", acceptance: ["a"], ...scope });
  assert.equal(refused.ok, false);
  assert.match(refused.text, /could not be read/, "the seat is told, rather than getting a lane in a project that forgot the first one");
  assert.equal(readFileSync(file, "utf-8"), kept, "an empty ledger written over it forgets every lane, task and working copy on record");

  // Reading is held to the same rule: status used to answer "No open lanes."
  const status = await h.call(sup, "supervisor", "status", {});
  assert.equal(status.ok, false);
  assert.match(status.text, /could not be read/);
  assert.doesNotMatch(status.text, /No open lanes/);
});

test("a detour hands back to the lane that was waiting on it, and cannot be opened for a lane that is not", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Checkout", outcome: "an order can be paid for", acceptance: ["a"], ...scope });
  const waiting = h.ledger().lanes.L1!;

  const nowhere = await h.call(sup, "supervisor", "open_lane", { title: "Money type", outcome: "money is not a float", acceptance: ["a"], detourOf: "L7", ...scope });
  assert.equal(nowhere.ok, false, "a detour for a lane that does not exist is a letter with nowhere to go");

  const detour = await h.call(sup, "supervisor", "open_lane", { title: "Money type", outcome: "money is not a float", acceptance: ["a"], detourOf: "l1", ...scope });
  assert.equal(detour.ok, true, detour.text);
  const lane = h.ledger().lanes.L2!;
  assert.equal(lane.detourOf, "L1");
  assert.match(h.agents.get(lane.lead!)!.prompt!, /clears the way for L1/, "the detour's Lead is told to do that and no more");

  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L2", reason: "done" })).ok, true);
  await h.idle(waiting.lead!);
  assert.match(h.agents.get(waiting.lead!)!.sent.join("\n"), /CLEARED L2[\s\S]*Next: Read what it did before you go on; ask if your work needs it on your branch\./, "the lane that waited cannot see the other one, so it has to be told");
});

/** Three lanes as a run opens them: the first in the project's own copy, the other two in copies of their own. */
async function threeLanes(gate: string) {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate });
  const scope = { outOfScope: ["anything else in the repository"] };
  for (const [title, path] of [["Part A", "a/**"], ["Part B", "b/**"], ["Part C", "c/**"]] as const) {
    const opened = await h.call(sup, "supervisor", "open_lane", { title, outcome: title, acceptance: ["done"], writeSet: [path], isolate: title !== "Part A", ...scope });
    assert.equal(opened.ok, true, opened.text);
  }
  const lanes = h.ledger().lanes;
  for (const lane of Object.values(lanes)) h.agents.get(lane.lead!)!.status = "idle";
  const work = (lane: { worktree?: string }, file: string, text = `${file}\n`) => {
    mkdirSync(join(lane.worktree!, dirname(file)), { recursive: true });
    writeFileSync(join(lane.worktree!, file), text);
    h.git(lane.worktree!, "add", "-A");
    h.git(lane.worktree!, "commit", "-qm", file);
  };
  return { h, sup, lanes, work };
}

test("a lane lands after another lane moved main, even while a third holds the project's own copy", async () => {
  const { h, sup, lanes, work } = await threeLanes("true");
  assert.equal(lanes.L1!.slot, undefined, "the first lane works in the project's own copy");
  work(lanes.L2!, "b/b.txt");
  work(lanes.L3!, "c/c.txt");

  const third = await h.call(sup, "supervisor", "land_lane", { lane: "L3" });
  assert.equal(third.ok, true, third.text);
  // main moved on and the only copy on it carries L1, yet L2 must still be landed, not closed unlanded.
  const second = await h.call(sup, "supervisor", "land_lane", { lane: "L2" });
  assert.equal(second.ok, true, second.text);
  assert.doesNotMatch(second.text, /not landed/);
  assert.equal(h.git(h.root, "show", "main:b/b.txt"), "b/b.txt\n");
  assert.equal(h.git(h.root, "show", "main:c/c.txt"), "c/c.txt\n");
  for (const id of ["L2", "L3"]) assert.equal((await h.call(sup, "supervisor", "release", { lane: id })).ok, true);
  assert.equal(h.git(h.root, "branch", "--list", lanes.L2!.branch, lanes.L3!.branch).trim(), "", "landed branches go with their copies, once their Leads are released");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), lanes.L1!.branch, "the lane in the project's own copy is not moved for it");
  assert.equal(h.ledger().lanes.L1!.status, "open");
});

test("the gate that lets a lane land runs on the lane with main's newer work in it", async () => {
  const { h, sup, lanes, work } = await threeLanes("test ! -f b/b.txt || test -f c/c.txt");
  work(lanes.L2!, "b/b.txt");
  work(lanes.L3!, "c/c.txt");
  assert.equal((await h.call(sup, "supervisor", "land_lane", { lane: "L3" })).ok, true);
  const second = await h.call(sup, "supervisor", "land_lane", { lane: "L2" });
  assert.equal(second.ok, true, second.text);
  assert.equal(h.git(h.root, "show", "main:b/b.txt"), "b/b.txt\n");
});

test("a lane closed in the project's own copy keeps that copy until its Lead stops, and the next lane waits for it or takes a copy of its own", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "First", outcome: "x", acceptance: ["a"], ...scope });
  const first = h.ledger().lanes.L1!;
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), first.branch);

  // Closed while its Lead is mid-turn, so putting the branch back waits for that Lead.
  const closed = await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "wrong outcome" });
  assert.equal(closed.ok, true, closed.text);
  assert.deepEqual(h.ledger().lanes.L1!.restoring!.writers, [first.lead!], "and the wait is on the record, not in memory");

  // Switched now, the first Lead's next commit would land on the next lane's branch.
  const asked = { title: "Second", outcome: "y", acceptance: ["a"], ...scope };
  assert.match((await h.call(sup, "supervisor", "open_lane", asked)).text, /Lane L1 is closed, but its Lead is still ending a turn in the project's own copy, which goes back to main when that turn ends\. Pass isolate/);
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /Lane L1 is closed, and its Lead is ending a turn in it; it goes back to main after\./);
  const next = await h.call(sup, "supervisor", "open_lane", { ...asked, isolate: true });
  assert.equal(next.ok, true, next.text);
  const second = h.ledger().lanes.L2!;
  assert.ok(second.slot, "in a copy of its own");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), first.branch, "the copy the first Lead is writing in is not moved under it");

  h.agents.get(first.lead!)!.status = "idle";
  await h.endTurn(first.lead!, "stopping");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main", "once it stops, the project's copy is back on its base");
  const copy = h.ledger().slots[second.slot!]!.path;
  h.commit(copy, "a.txt", "L2 work\n");
  assert.equal(h.git(h.root, "log", "-1", "--format=%s", second.branch).trim(), "edit a.txt", "and L2's commits are on L2's branch");

  // And a Lead that never comes back at all: the round finishes what its turn was holding up.
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L2", reason: "done" })).ok, true);
  h.agents.get(second.lead!)!.archivedAt = new Date().toISOString();
  await h.tick(Date.now());
  assert.deepEqual(Object.keys(h.ledger().slots), [], "its copy is put away, not left behind for good");
});

test("a copy waiting on a seat that never ends its turn is put away in the round, not left for good", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Abandoned", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  const lane = h.ledger().lanes.L1!;
  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "the outcome was wrong" });
  await h.call(sup, "supervisor", "release", { lane: "L1" });
  assert.equal(existsSync(lane.worktree!), true, "the Lead is mid-turn, so the copy waits for it");
  assert.deepEqual(h.ledger().slots[lane.slot!]!.releasing!.writers, [lane.lead!], "and what it is waiting on is on the record, not only in memory");

  // The turn never ends: archived, crashed, or the desk restarted; nothing writes there any more.
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  await h.tick(Date.now());

  assert.equal(existsSync(lane.worktree!), false, "the round puts it away rather than leaving a copy and a workspace for good");
  assert.deepEqual(Object.keys(h.ledger().slots), []);
});

test("a copy two seats are writing in is put away by the last of them to stop, not the first", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Both in here", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "In the lane's copy", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;
  assert.equal(h.agents.get(task.peer!)!.cwd, lane.worktree, "a lane-mode Peer writes in the lane's own copy, beside its Lead");
  writeFileSync(join(lane.worktree!, "half-written.txt"), "the Peer is mid-sentence\n");

  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "the outcome was wrong" })).ok, true);
  const released = await h.call(sup, "supervisor", "release", { lane: "L1" });
  assert.match(released.text, new RegExp(`${lane.lead} and ${task.peer}`), "both are named, because both are still writing there");

  h.agents.get(task.peer!)!.status = "idle";
  await h.endTurn(task.peer!, "stopping");
  assert.equal(existsSync(join(lane.worktree!, "half-written.txt")), true, "the Peer stopped, and the Lead is still in there");
  assert.ok(h.ledger().slots[lane.slot!], "so the copy is still the lane's");

  h.agents.get(lane.lead!)!.status = "idle";
  await h.endTurn(lane.lead!, "stopping too");
  assert.equal(existsSync(lane.worktree!), false, "the last one out puts it away");
  assert.deepEqual(Object.keys(h.ledger().slots), []);
});

test("with gateOn task, the gate really runs on a lane-mode task and the Lead is told the result, not a description", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "test ! -f BROKEN", gateOn: "task" });
  const scope = { outOfScope: ["the rest of the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add four", goal: "g", acceptance: ["a"], owned: ["a.txt"], ...scope }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.commit(lane.worktree!, "a.txt", "one\ntwo\nthree\nfour\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "four" });
  h.agents.get(peer)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);

  // The task is on the default, non-parallel path — the one where the task gate used to be skipped in silence.
  await h.idle(lane.lead!);
  const letter = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(letter, /MERGED L1-T1/);
  assert.match(letter, /Gate: test ! -f BROKEN passed in/, "the Lead has to be told what the gate did, not what it would do later");
  assert.doesNotMatch(letter, /Gate: runs on the whole lane/, "gateOn task means the lane note is a lie for this task");
});

test("a red task gate reaches the Lead with the hand-back, and landing it anyway is the Lead's call", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "echo red; exit 1", gateOn: "task" });
  await h.call(sup, "supervisor", "open_lane", { title: "Bee", outcome: "b.txt changes", acceptance: ["b"], outOfScope: ["anything else in the repository"], writeSet: ["b.txt"] });
  const lane = h.ledger().lanes.L1!;
  const started = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], outOfScope: ["the rest of the repository"], parallel: true }] });
  assert.equal(started.ok, true, started.text);
  const task = h.ledger().tasks["L1-T1"]!;
  h.commit(task.worktree!, "b.txt", "B\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "b" });

  // LEAD.md promises the per-task verdict with the hand-back, as evidence and not a veto.
  await h.idle(lane.lead!);
  const handback = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(handback, /Gate: echo red; exit 1: the gate failed with exit 1/);
  assert.match(handback, /evidence for your decision, not a decision/);

  h.agents.get(task.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged", "accepted with the verdict in hand, it lands");
  assert.match(h.git(lane.worktree!, "log", "-1", "--format=%s"), /^Merge L1-T1/);
});

test("a commit made while the lane's copy is off its branch is not accepted as landed", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Regression", outcome: "the bug goes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Find it", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;

  // What a bisect leaves behind: a clean copy, on no branch, with the fix committed into nothing.
  h.git(lane.worktree!, "checkout", "-q", "--detach", "HEAD");
  h.commit(lane.worktree!, "a.txt", "fixed at the source\n");
  const handed = await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "found and fixed it" });
  assert.equal(handed.ok, true, "the hand-back is not refused — the Peer is told, while it can still put it right");
  assert.match(handed.text, new RegExp(`not on ${lane.branch} any more`));
  assert.match(handed.text, /git bisect reset takes it back[^]*left it some other way, say so with ask/, "nothing else it may run puts a copy back");

  h.agents.get(task.peer!)!.status = "idle";
  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(accepted.ok, false, "clean and detached is what the desk used to read as landed");
  assert.match(accepted.text, /nothing committed in it is on the lane branch[^]*git bisect reset[^]*some other way[^]*raise it with ask/);
  assert.equal(h.git(lane.worktree!, "show", `${lane.branch}:a.txt`), "one\ntwo\nthree\n", "and the lane branch really does not have it");
});

test("a task cannot be told to open a skill its Peer does not have", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Skilled", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  const scope = { goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] };

  // Nothing in a Lead's context lists the Peer's skills, so a guessed one must be refused.
  const guessed = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Guessed", ...scope, skills: ["tdd"] }] });
  assert.equal(guessed.ok, false);
  assert.match(guessed.text, /no skill called tdd/);
  assert.match(guessed.text, /They have: /, "and the refusal is where the Lead finds out what there is");

  const real = guessed.text.split("They have: ")[1]!.replace(/\.$/, "").split(", ")[0]!;
  const named = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Named", ...scope, skills: [real] }] });
  assert.equal(named.ok, true, named.text);
  const started = Object.values(h.ledger().tasks).find((task) => task.title === "Named")!;
  assert.match(h.agents.get(started.peer!)!.prompt!, new RegExp(`Skills to open: ${real}`));
  assert.equal(Object.values(h.ledger().tasks).some((task) => task.title === "Guessed"), false, "a refused task does not take an id either");
});

test("a hand-back the Lead has not accepted still holds the lane's copy, so nothing is sent in beside it", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["the rest of the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Two in a row", outcome: "a and b change", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], ...scope }] });
  const first = h.ledger().tasks["L1-T1"]!;
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(first.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(first.peer!)!.status = "idle";

  // Its Peer is still seated and rework would wake it in that directory, so the copy is not free yet.
  const second = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], ...scope }] });
  assert.match(second.text, /L1-T2 B: held: L1-T1 has handed back and is waiting on you/);
  assert.equal(h.ledger().tasks["L1-T2"]!.peer, undefined, "nobody is sent into the copy beside it");

  // With the second task never started, the copy is clean and the first accepts as it always did; the second then starts.
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "running");

  // And a rework that would wake a Peer into another task's writing is refused, not prescribed.
  const back = await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "commit it" });
  assert.equal(back.ok, false);
  assert.match(back.text, /L1-T2 holds the lane's working copy/, "its Peer goes back to it only once the copy is free");
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "C", goal: "g", acceptance: ["c"], owned: ["c.txt"], ...scope, parallel: true }] });
  const par = Object.values(h.ledger().tasks).find((task) => task.title === "C")!;
  writeFileSync(join(lane.worktree!, "b.txt"), "half\n");
  const reworkPar = await h.call(lane.lead!, "lead", "rework", { task: par.id, text: "again" });
  assert.equal(reworkPar.ok, true, "a parallel task has a copy of its own, so its rework is nobody else's business");
});

test("a task whose honest answer is that nothing needed changing can be accepted, not only cut", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Audit", outcome: "the parser is checked", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Check the parser", goal: "find out whether it drops input", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;

  // The Peer investigates, finds the code already correct, and commits nothing. That is a real outcome.
  await h.call(peer, "peer", "done", { outcome: "nothing needed changing", summary: "the parser already handles it" });
  h.agents.get(peer)!.status = "idle";
  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(accepted.ok, true, accepted.text);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged", "the Lead judges the hand-back; the desk does not decide that no diff means no work");

  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /changed no files/, "the letter says plainly that nothing moved");
});

test("a seat reaches only the tools its own role holds, whatever it asks for", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Work", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Edit", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;

  // The tool exists on the desk, and this seat's role is not given it.
  const reach = await h.call(peer, "peer", "open_lane", { title: "Mine", outcome: "x", acceptance: ["y"], outOfScope: ["z"] });
  assert.equal(reach.ok, false);
  assert.match(reach.text, /Unknown tool open_lane/);
  assert.equal(Object.keys(h.ledger().lanes).length, 1, "nothing was opened");

  // And a seat cannot borrow another role's name to get at them either.
  const borrowed = await h.call(peer, "lead", "add_tasks", { tasks: [{ key: "t", title: "Mine", goal: "g", acceptance: ["a"], owned: ["b.txt"], outOfScope: ["z"] }] });
  assert.equal(borrowed.ok, false);
  assert.match(borrowed.text, /lead tools are not available to it/);
});

test("two supervising seats hold one project, and each lane's mail goes to the seat that opened it", async () => {
  const h = harness();
  const architecture = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "architecture");
  const safety = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "safety");
  const scope = { outOfScope: ["anything else"] };

  await h.call(architecture, "supervisor", "open_lane", { title: "Schema", outcome: "the schema moves", acceptance: ["a"], ...scope });
  // The hole found mid-lane gets its own Lead and its own copy, rather than the first lane widening to swallow it.
  await h.call(safety, "supervisor", "open_lane", { title: "Permissions", outcome: "writes are checked", acceptance: ["a"], isolate: true, detourOf: "L1", ...scope });
  const lanes = h.ledger().lanes;
  assert.equal(lanes.L1!.opener, architecture);
  assert.equal(lanes.L2!.opener, safety);
  assert.equal(lanes.L2!.detourOf, "L1");
  assert.match(h.agents.get(lanes.L2!.lead!)!.prompt ?? "", /clears the way for L1/, "the detour's Lead is told what it is unblocking");

  await h.call(lanes.L1!.lead!, "lead", "report", { summary: "schema done", ready: false });
  await h.call(lanes.L2!.lead!, "lead", "report", { summary: "permissions done", ready: false });
  await h.idle(architecture);
  await h.idle(safety);
  assert.match(h.agents.get(architecture)!.sent.join("\n"), /schema done/);
  assert.doesNotMatch(h.agents.get(architecture)!.sent.join("\n"), /permissions done/, "one supervising seat does not read another's lane");
  assert.match(h.agents.get(safety)!.sent.join("\n"), /permissions done/);
});

test("reaching a Peer directly tells its Lead what reached it, and is refused when there is no Lead to tell", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Pricing", outcome: "discounts round correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Round", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] }] });
  const task = h.ledger().tasks["L1-T1"]!;

  const reached = await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "Use banker's rounding, not half-up." });
  assert.equal(reached.ok, true, reached.text);
  await h.idle(task.peer!);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(task.peer!)!.sent.join("\n"), /banker's rounding/);

  // The Lead is not merely copied: it is given back the five things it needs to hold the room's state.
  const toLead = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(toLead, /RECONCILE L1/);
  assert.match(toLead, /banker's rounding/, "what reached the Peer");
  assert.match(toLead, /Current intent: discounts round correctly/);
  assert.match(toLead, /Ownership: L1-T1 .* is still owned by/);
  assert.match(toLead, /Topology: unchanged/);
  assert.match(toLead, /Integration and acceptance: unchanged/);

  // The same instruction again is a second instruction, not a repeat to drop by its words.
  await h.idle(task.peer!);
  await h.idle(lane.lead!);
  assert.equal((await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "Use banker's rounding, not half-up." })).ok, true);
  await h.idle(task.peer!);
  await h.idle(lane.lead!);
  assert.equal(h.agents.get(task.peer!)!.sent.join("\n").split("banker's rounding").length - 1, 2, "both reached the Peer");
  assert.equal(h.agents.get(lane.lead!)!.sent.join("\n").split("RECONCILE L1").length - 1, 2, "and the Lead was told both times");

  // With no Lead to reconcile to, the intervention is refused rather than run behind its back.
  Object.assign(h.agents.get(lane.lead!)!, { archivedAt: new Date().toISOString(), status: "closed" });
  const orphaned = await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "One more thing." });
  assert.equal(orphaned.ok, false);
  assert.match(orphaned.text, /no running Lead/);

  // A task already cut has no Peer left to steer.
  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" });
  const cut = await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "One more thing." });
  assert.equal(cut.ok, false);
  assert.match(cut.text, /L1-T1 is cut/);
});

test("an ask answered by the owner over a Lead's head is told to that Lead, not run behind its back", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Columns", outcome: "the column goes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Drop it", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;

  // Unanswered asks escalate to the owner, so the owner answering one is the design.
  const asked = await h.call(task.peer!, "peer", "ask", { question: "Drop the column or keep it nullable?", tried: "read the migration", bestGuess: "keep it nullable" });
  assert.equal(asked.ok, true, asked.text);
  const ask = Object.values(h.ledger().asks)[0]!;
  assert.equal(ask.to, lane.lead, "an ask goes upward, to the Lead");

  const answered = await h.call(sup, "supervisor", "answer", { ask: ask.id, text: "Drop it and migrate." });
  assert.equal(answered.ok, true, answered.text);
  await h.idle(task.peer!);
  assert.match(h.agents.get(task.peer!)!.sent.join("\n"), /Drop it and migrate/, "the Peer gets its answer");

  await h.idle(lane.lead!);
  const toLead = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(toLead, new RegExp(`ANSWERED FOR YOU: ${ask.id}`), "the Lead cannot hold the room's state on an answer it never saw");
  assert.match(toLead, /Drop it and migrate/);
  assert.match(toLead, /accepting it is still yours to judge/);
});

test("a Lead is pointed at the project's concept once the Human has settled one, and set_project keeps no pages", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");

  // Nothing is written for the Supervisor, and a Lead is not sent to read a file that is not there.
  await h.call(sup, "supervisor", "open_lane", { title: "First", outcome: "x", acceptance: ["y"], outOfScope: ["z"], writeSet: ["a.txt"] });
  const first = h.ledger().lanes.L1!;
  assert.equal(existsSync(join(h.project.state, "CONTEXT.md")), false);
  assert.doesNotMatch(h.agents.get(first.lead!)!.prompt ?? "", /CONTEXT\.md/);

  writeFileSync(join(h.project.state, "CONTEXT.md"), "# Shop\n\n## Behavior\n\n- A guest may check out.\n");
  await h.call(sup, "supervisor", "open_lane", { title: "Second", outcome: "x", acceptance: ["y"], outOfScope: ["z"], writeSet: ["b.txt"], isolate: true });
  const second = h.ledger().lanes.L2!;
  const directive = h.agents.get(second.lead!)!.prompt ?? "";
  assert.match(directive, new RegExp(`is in ${join(h.project.state, "CONTEXT.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. Read it before you start`));
  assert.match(directive, /ask with kind question, and leave the file as it is/, "it is the Human's word, not the Lead's to edit");

  const pages = await h.call(sup, "supervisor", "set_project", { docs: ["decision"] });
  assert.equal(pages.ok, false, "the shelf of pages is gone, and so is the argument that kept them");
});

test("a copy a reviewer is reading is not taken away when the task it reviews is accepted", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["the rest of the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Reviewed", outcome: "a and b change", acceptance: ["a"], outOfScope: ["anything else in the repository"], writeSet: ["a.txt", "b.txt"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], ...scope, parallel: true }] });
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
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], ...scope, parallel: true }] });
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
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], ...scope, parallel: true }] });
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
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], ...scope, parallel: true }] });
  const empty = Object.values(h.ledger().tasks).find((entry) => entry.title === "B")!;
  const cutReply = await h.call(lane.lead!, "lead", "cut", { task: empty.id, reason: "wrong shape" });
  assert.equal(cutReply.ok, true, cutReply.text);
  assert.equal(h.git(h.root, "branch", "--list", empty.branch!).trim(), "", "a cut task with no commits of its own leaves no branch behind");
  const nothing = await h.call(lane.lead!, "lead", "start_review", { task: empty.id, focus: "anything?" });
  assert.equal(nothing.ok, false);
  assert.match(nothing.text, /neither a merge nor a branch is left to read it from/);
});

test("a task branch is dropped once its work is in the lane's and its Peer is released, whichever branch the project's own copy is on", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  // The lane's own copy keeps the project's copy on main, which is what `git branch -d` would read.
  await h.call(sup, "supervisor", "open_lane", { title: "Apart", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  const lane = h.ledger().lanes.L1!;
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"], parallel: true }] });
  const task = h.ledger().tasks["L1-T1"]!;
  h.commit(task.worktree!, "a.txt", "A\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(task.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);

  assert.equal((await h.call(lane.lead!, "lead", "release", { task: "L1-T1" })).ok, true, "a merged task's Peer, released, takes its copy with it");
  assert.equal(h.git(lane.worktree!, "show", `${lane.branch}:a.txt`), "A\n", "the work is in the lane's branch");
  assert.equal(h.git(h.root, "branch", "--list", task.branch!).trim(), "", "and its own branch has nothing the lane does not, so it goes");
});

test("a task goes to a role that writes, and a review to one that reads, and neither stands in for the other", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;

  // The preset's Reviewer holds `work` for routing but is denied every write, so it is no second kind of Peer.
  const readOnly = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add four", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"], role: "reviewer" }] });
  assert.equal(readOnly.ok, false, "a role that only reads cannot be given a task to write");
  assert.match(readOnly.text, /no reviewer that can take a task/i);
  assert.match(readOnly.text, /peer/, "and the refusal names who can, rather than recommending the one that cannot");
  assert.deepEqual(Object.keys(h.ledger().tasks), [], "and nothing was started or recorded");

  const wrongLens = await h.call(lane.lead!, "lead", "start_review", { focus: "Is the rounding right?", role: "peer" });
  assert.equal(wrongLens.ok, false);
  assert.match(wrongLens.text, /no peer that can review/i);
  assert.match(wrongLens.text, /reviewer/, "the refusal names what there is to choose from");

  const byDefault = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add five", goal: "g", acceptance: ["a"], owned: ["b.txt"], outOfScope: ["the rest"] }] });
  assert.equal(byDefault.ok, true, byDefault.text);
  const seated = Object.values(h.ledger().tasks).find((task) => task.title === "Add five")!;
  assert.match(h.agents.get(seated.peer!)!.provider, /peer/, "left out, it is the preset's own default");
});

test("two projects on one daemon both name their first task L1-T1, and both Leads are told when their Peer is gone", async () => {
  const h = harness();
  const second = repo();
  const other = projectOf(second.root);

  const open = async (where: string, name: string) => {
    const sup = h.add("sw2-supervisor-claude/claude-opus-5", where, name);
    await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["the rest"] }, where);
    const lane = h.ledger(where === h.root ? undefined : other).lanes.L1!;
    await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Add four", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] }] }, where);
    return lane;
  };
  const here = await open(h.root, "sup-a");
  const there = await open(second.root, "sup-b");

  const mine = h.ledger().tasks.L1_T1 ?? h.ledger().tasks["L1-T1"]!;
  const theirs = h.ledger(other).tasks["L1-T1"]!;
  assert.equal(mine.id, theirs.id, "the two ledgers really do use the same task id");

  for (const task of [mine, theirs]) h.agents.get(task.peer!)!.archivedAt = new Date().toISOString();
  await h.tick(Date.now());
  await h.idle(here.lead!);
  await h.idle(there.lead!);

  assert.match(h.agents.get(here.lead!)!.sent.join("\n"), /the Peer on L1-T1/, "the first project's Lead is told");
  assert.match(h.agents.get(there.lead!)!.sent.join("\n"), /the Peer on L1-T1/, "and so is the second's — the letter key and the seen-it flag are per project");
  assert.equal(h.ledger(other).tasks["L1-T1"]!.status, "stalled", "and the second project's task is recorded stalled, not skipped");
});

test("a question that would stop a seat's turn is refused with where to ask instead, while leave to run something waits for the Human", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Colours", outcome: "the button is coloured", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Colour", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  const question: Pending = { id: "permission-1", kind: "question", name: "AskUserQuestion", title: "Which colour should the button be?", input: { questions: [{ question: "Which colour should the button be?", options: [{ label: "Blue" }] }] } };
  for (const [seat, text] of [[peer, /ask it with ask, then end your turn/], [sup, /put it to the Human with ask_human, or ask them in your reply and end your turn/]] as const) {
    h.agents.get(seat)!.pending.push(question);
    await h.permission(seat, question);
    assert.equal(h.agents.get(seat)!.answered.at(-1)!.response.behavior, "deny");
    assert.match(String((h.agents.get(seat)!.answered.at(-1)!.response as { message?: string }).message), text);
  }
  await h.idle(lane.lead!);
  assert.doesNotMatch(h.agents.get(lane.lead!)!.sent.join("\n"), /WAITING FOR PERMISSION/, "nobody is asked to answer a question the seat was told to put another way");

  // Leave to run something is the Human's to give; the desk answers nothing on anyone's behalf.
  const command: Pending = { id: "permission-2", kind: "tool", name: "Bash", title: "rm -rf build" };
  h.agents.get(peer)!.pending.push(command);
  await h.permission(peer, command);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /WAITING FOR PERMISSION[^]*Bash: rm -rf build\n\nOnly the Human can answer this[^]*\n\nNext: If it holds the lane up, ask, so the owner can tell the Human\./);
  const held = await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: "Go ahead." });
  assert.match(held.text, /stopped on a permission only the Human can give/);
  assert.equal(h.agents.get(peer)!.answered.length, 1, "the command is left for the Human");
  assert.equal(h.runtime.outbox.pending(peer).length, 1, "and the message waits for it");
});

test("mail reaches a running seat inside its turn where its harness can take it there, and waits where it cannot", async () => {
  const h = harness();
  // omp takes mail only between turns.
  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ roles: { peer: { harness: "omp", model: "glm-5" } } }));
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Pricing", outcome: "discounts round correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Round", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  assert.equal(h.agents.get(lane.lead!)!.status, "running");
  assert.equal(h.agents.get(peer)!.status, "running");

  // Paseo turns a steer the provider cannot take yet into replacing the turn, so a new turn is left alone.
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    h.beginTurn(lane.lead!);
    h.beginTurn(peer);
    const early = await h.call(sup, "supervisor", "message", { to: "L1", text: "Is the premise right?" });
    assert.match(early.text, /Queued for the Lead of L1/);
    mock.timers.tick(2 * 60_000);
    await h.tick();
    assert.match(h.agents.get(lane.lead!)!.steered.join("\n"), /Is the premise right\?/, "the round delivers it once the turn has settled");

    const toLead = await h.call(sup, "supervisor", "message", { to: "L1", text: "Stop: the premise is wrong." });
    assert.match(toLead.text, /Delivered to the Lead of L1/);
    assert.match(h.agents.get(lane.lead!)!.steered.join("\n"), /the premise is wrong/, "the Lead's harness takes it mid-turn");

    const toPeer = await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: "Stop: the premise is wrong." });
    assert.match(toPeer.text, /Queued for the Peer on L1-T1/);
    assert.deepEqual(h.agents.get(peer)!.sent, [], "the Peer's harness cannot, and sending would replace its turn");
  } finally {
    mock.timers.reset();
  }
});

test("an incident about a Peer whose Lead is gone goes to whoever supervises, and a Lead reads and marks only its own lane's", async () => {
  const { h, sup, lane, peer } = await laneWithPeer({ attention: { watch: true, incidentsPerLane: 3 } });
  const lead = lane.lead!;
  const about = (seat: string, kind: string, level: "attend" | "page" = "attend") =>
    h.runtime.desk.notice(h.project, { id: seat, provider: h.agents.get(seat)!.provider, title: seat }, [{ kind, level, quote: `${kind} seen`, facts: [kind] }]);
  await about(peer, "test-weakened");
  await about(lead, "long-turn");
  await h.idle(lead);
  await h.idle(sup);
  assert.match(h.agents.get(lead)!.sent.join("\n"), /INCIDENT I1 \(test-weakened, attend\)/);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I2 \(long-turn, attend\) on the Lead/, "one about the Lead goes above it");

  const listed = await h.call(lead, "lead", "incidents", {});
  assert.equal(listed.ok, true, listed.text);
  assert.match(listed.text, /I1 \[attend/);
  assert.doesNotMatch(listed.text, /I2/, "never one about itself");
  const own = await h.call(lead, "lead", "mark_incident", { id: "I2", verdict: "noise", note: "expected" });
  assert.equal(own.ok, false, "nor may it mark one");
  assert.match(own.text, /no incident I2 here for you/);
  const marked = await h.call(lead, "lead", "mark_incident", { id: "I1", verdict: "useful", note: "it was going round" });
  assert.equal(marked.ok, true, marked.text);
  assert.match((await h.call(sup, "supervisor", "incidents", { closed: true })).text, /I1 \[attend, closed, told [^\]]*, marked useful\]/, "whoever supervises sees what the Lead marked");

  h.agents.get(lead)!.archivedAt = new Date().toISOString();
  await about(peer, "suppressed");
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I3 \(suppressed, attend\) on the Peer/, "with its Lead gone, it goes above");
});

const incidentsOf = (state: string) => JSON.parse(readFileSync(join(state, "incidents.json"), "utf-8")).items as Record<string, { kind: string; held?: string; told?: number; level: string }>;

test("an irreversible command a Peer starts reaches the Supervisor before the call finishes, and nothing of it reaches the Peer", async () => {
  const { h, sup, peer, timeline } = await laneWithPeer({ attention: { watch: true } });
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "running", detail: { type: "unknown", input: {}, output: null } }, "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "running", detail: { type: "shell", command: "rm -rf build" } }, "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.idle(sup);
  const told = h.agents.get(sup)!.sent.join("\n");
  assert.match(told, /INCIDENT I1 \(destructive, page\) on the Peer on L1-T1 \(Clean build\)/);
  assert.match(told, /What was seen: rm -rf build/);
  assert.match(told, /not a verdict/);
  assert.ok(!timeline.rows.some((row) => row.item.status === "completed"), "the call it warns about is still running");
  assert.deepEqual(h.runtime.outbox.letters().filter((letter) => letter.to === peer), [], "nothing the watch concluded is even queued for the seat it watches");
  await h.idle(peer);
  const watched = h.agents.get(peer)!;
  assert.deepEqual([...watched.sent, ...watched.steered].filter((text) => /INCIDENT|destructive|rm -rf|incident/i.test(text)), [], "nor reaches it when its turn ends");
});

test("a turn that runs long is told to the Peer's Lead", async () => {
  const { h, sup, lane, timeline } = await laneWithPeer({ attention: { watch: true } });
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Make the build pass" }, "t1");
  await settle();
  await h.tick(Date.now() + 31 * 60_000);
  await h.idle(sup);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /INCIDENT I1 \(long-turn, attend\)/, "one about a Peer goes to its Lead");
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I1/);
});

test("two projects each hear about their own seats, though their incidents carry the same number", async () => {
  const { h, sup } = await laneWithPeer({ attention: { watch: true } });
  const second = repo();
  const other = projectOf(second.root);
  mkdirSync(other.state, { recursive: true });
  writeFileSync(join(other.state, "settings.json"), JSON.stringify({ attention: { watch: true } }));
  const supB = h.add("sw2-supervisor-claude/claude-opus-5", second.root, "sup-b");
  const page = [{ kind: "destructive", level: "page" as const, quote: "rm -rf build", facts: ["destructive"] }];
  await h.runtime.desk.notice(h.project, { id: "p-a", provider: "sw2-peer-claude/claude-opus-5" }, page);
  await h.runtime.desk.notice(other, { id: "p-b", provider: "sw2-peer-claude/claude-opus-5" }, page);
  await h.idle(sup);
  await h.idle(supB);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I1 \(destructive, page\)/);
  assert.match(h.agents.get(supB)!.sent.join("\n"), /INCIDENT I1 \(destructive, page\)/, "the second project's owner is told too, not dropped as a repeat of the first");
});

test("a lane's own record is gone through for what no turn shows", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  await h.tick();
  await h.idle(sup);
  const book = JSON.parse(readFileSync(join(h.project.state, "incidents.json"), "utf-8")) as { items: Record<string, { kind: string }> };
  assert.deepEqual(Object.values(book.items).map((item) => item.kind), ["rework-loop"]);
});

test("a task the Lead keeps sending back is an incident about the Lead, raised once and never shown to it", async () => {
  const { h, sup, lane, peer } = await laneWithPeer({ attention: { watch: true } });
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.reworks, 3, "three sendings-back are on the record");

  await h.tick();
  await h.idle(sup);
  const told = h.agents.get(sup)!.sent.join("\n");
  assert.match(told, /INCIDENT I1 \(rework-loop, attend\) on the Lead of L1 \(Build\)/, "the seat it is about is the one that decides to send it back");
  assert.match(told, /What was seen: L1-T1 \(Clean build\) has been sent back 3 times/);

  // Three sendings-back stay three forever, so once marked the unchanged record must not raise again.
  const marked = await h.call(sup, "supervisor", "mark_incident", { id: "I1", verdict: "noise", note: "expected: the brief changed under it" });
  assert.equal(marked.ok, true, marked.text);
  await h.tick();
  await h.tick();
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), ["I1"], "the same three sendings-back are not raised again once they have been marked");

  // A fourth is new evidence, and is raised.
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "round 4" });
  await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "still not" });
  await h.tick();
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), ["I1", "I2"], "a fourth sending-back is something new to say");
});

test("a standing condition held back while the watch is off is still there to tell when it is turned on", async () => {
  // A lane's history never changes on its own, so a condition held while off must be told when turned on.
  const { h, sup, lane, peer } = await laneWithPeer();
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  await h.tick();
  await h.idle(sup);
  assert.deepEqual(Object.values(incidentsOf(h.project.state)).map((item) => [item.kind, item.held]), [["rework-loop", "shadow"]]);
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /INCIDENT/);

  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ attention: { watch: true } }));
  await h.tick();
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I1 \(rework-loop, attend\)/, "the same unchanged record is told once the owner turns it on");
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), ["I1"], "and it is the incident already on the book, not a second one");
});

test("a lane whose Lead has gone raises nothing about it, since nothing would ever close it", async () => {
  const { h, lane, peer } = await laneWithPeer({ attention: { watch: true } });
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  await h.tick();
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), [], "an incident about a seat that has gone is one nobody can close");
});

test("every call is held to the schema the seat was shown, and told what it takes", async () => {
  // An unchecking harness sent prose, misnamed fields and lists, and the desk wrote "No summary given." into hand-backs.
  const { h, lane, peer } = await laneWithPeer();
  const prose = await h.call(peer, "peer", "done", { outcome: "I finished the module and tests pass", summary: "built it" });
  assert.equal(prose.ok, false, prose.text);
  assert.match(prose.text, /outcome must be one of complete, partial, blocked/);
  const misnamed = await h.call(peer, "peer", "done", { outcome: "complete", summary: "built it", commits: "abc", checks: ["npm test"] });
  assert.equal(misnamed.ok, false);
  assert.match(misnamed.text, /no field commits/);
  assert.match(misnamed.text, /checks must be text/);
  assert.match(misnamed.text, /It takes outcome, summary, and optionally checks, leftUndone, discovered/);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "nothing was handed back");
  const report = await h.call(lane.lead!, "lead", "report", { summary: "done", carries: "a note" });
  assert.equal(report.ok, false);
  assert.match(report.text, /needs ready/);
  const blank = await h.call(peer, "peer", "done", { outcome: "complete", summary: "  " });
  assert.match(blank.text, /needs summary/, "a required text has to say something");
  assert.match((await h.call(lane.lead!, "lead", "ask", { kind: "question", text: "Which one?" })).text, /needs default \(What you do meanwhile/, "a Lead that asks says what it does meanwhile");
  assert.match((await h.call(peer, "peer", "ask", { question: "Which one?" })).text, /needs bestGuess \(Your best answer to it/, "a Peer that asks says its best guess");
});

test("a patrol round files finished lanes past the newest few into the archive, and leaves the rest", async () => {
  const h = harness();
  h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.tick(Date.now());
  const ledger = h.ledger();
  for (let n = 1; n <= KEEP_CLOSED_LANES + 1; n++) {
    ledger.lanes[`L${n}`] = { id: `L${n}`, title: `old ${n}`, outcome: "", acceptance: [], outOfScope: [], base: "main", branch: `lane/l${n}`, writeSet: [], contracts: [], opener: "sup", status: "closed", openedAt: n, tasks: 0, lead: `gone-lead-${n}` };
  }
  ledger.seq.lane = KEEP_CLOSED_LANES + 1;
  saveLedger(h.project.state, ledger);
  mkdirSync(join(h.project.state, "handbacks"), { recursive: true });
  writeFileSync(join(h.project.state, "handbacks", "L1-T1-1.md"), "what L1 handed back");
  await h.tick(Date.now());
  assert.ok(!existsSync(join(h.project.state, "handbacks", "L1-T1-1.md")), "its hand-back went with it");
  assert.equal(h.ledger().lanes.L1, undefined, "the oldest finished lane left the ledger");
  assert.equal(Object.keys(h.ledger().lanes).length, KEEP_CLOSED_LANES);
  const filed = gunzipSync(readFileSync(join(h.project.state, "archive", "L1.json.gz"))).toString("utf-8");
  assert.match(filed, /"id":"L1"/);
  assert.match(filed, /what L1 handed back/);
});
