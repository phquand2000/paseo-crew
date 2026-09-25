import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../tempdir.ts";
import { harness, laneWithPeer } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
const onBranch = (h: ReturnType<typeof harness>, cwd: string) => h.git(cwd, "branch", "--show-current").trim();
const has = (h: ReturnType<typeof harness>, cwd: string, ref: string, file: string) => h.git(cwd, "ls-tree", "--name-only", ref, file).trim() === file;

test("a task in the lane's copy works on a branch of its own there, and the lane branch takes its work only by its merge", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const task = h.ledger().tasks["L1-T1"]!;
  assert.match(task.branch!, /^task\/l1-t1-/);
  assert.equal(onBranch(h, lane.worktree!), task.branch);
  h.commit(lane.worktree!, "new.txt", "new\n");
  assert.equal(has(h, lane.worktree!, lane.branch, "new.txt"), false, "the lane branch has none of it yet");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "new" });
  h.agents.get(peer)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.equal(h.git(lane.worktree!, "log", "-1", "--format=%s", lane.branch).trim(), "Merge L1-T1: Clean build");
  assert.equal(onBranch(h, lane.worktree!), lane.branch, "the copy is back on the lane branch, with nothing changed in it");
  assert.equal(h.git(lane.worktree!, "status", "--porcelain").trim(), "");
});

test("a cut task in the lane's copy leaves the lane branch as it was, puts the copy back on it, and keeps a branch that holds commits", async () => {
  const { h, lane } = await laneWithPeer();
  const task = h.ledger().tasks["L1-T1"]!;
  const before = h.git(lane.worktree!, "rev-parse", lane.branch).trim();
  h.commit(lane.worktree!, "new.txt", "new\n");
  writeFileSync(join(lane.worktree!, "a.txt"), "half done\n");
  const cut = await h.call(lane.lead!, "lead", "cut", { task: "L1-T1", reason: "wrong approach" });
  assert.equal(cut.ok, true, cut.text);
  assert.match(cut.text, new RegExp(`The lane's working copy is back on ${lane.branch}\\. Its branch ${task.branch} holds commits nothing else has and is kept\\.`));
  assert.equal(h.git(lane.worktree!, "rev-parse", lane.branch).trim(), before);
  assert.equal(onBranch(h, lane.worktree!), lane.branch);
  assert.equal(readFileSync(join(lane.worktree!, "a.txt"), "utf-8"), "one\ntwo\nthree\n", "its work in progress is gone with it");
});

test("a task beside others merges into the lane while a task in the lane's copy is at work there, and that copy is not touched", async () => {
  const { h, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "s", title: "Side", goal: "g", ...scope, holds: ["c.txt"], parallel: true }] });
  const side = h.ledger().tasks["L1-T2"]!;
  writeFileSync(join(lane.worktree!, "a.txt"), "being written\n");
  h.commit(side.worktree!, "c.txt", "C\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  h.agents.get(side.peer!)!.status = "idle";
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged", "no wait on the other task's work in progress");
  assert.equal(has(h, lane.worktree!, lane.branch, "c.txt"), true);
  assert.equal(readFileSync(join(lane.worktree!, "a.txt"), "utf-8"), "being written\n");
  assert.equal(onBranch(h, lane.worktree!), h.ledger().tasks["L1-T1"]!.branch);
});

test("the next task in the lane's copy starts on a branch of its own from the lane as merged so far", async () => {
  const { h, lane, peer } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "n", title: "Next", goal: "g", ...scope, after: ["L1-T1"] }] });
  h.commit(lane.worktree!, "new.txt", "new\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "new" });
  h.agents.get(peer)!.status = "idle";
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  const next = h.ledger().tasks["L1-T2"]!;
  assert.equal(next.status, "running");
  assert.equal(onBranch(h, lane.worktree!), next.branch);
  assert.equal(has(h, lane.worktree!, "HEAD", "new.txt"), true, "it starts from the lane with L1-T1 merged in");
});

test("a commit made while the lane's copy is off its branch is not accepted as landed", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Regression", outcome: "the bug goes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Find it", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const task = h.ledger().tasks["L1-T1"]!;

  // What a bisect leaves behind: a clean copy, on no branch, with the fix committed into nothing.
  h.git(lane.worktree!, "checkout", "-q", "--detach", "HEAD");
  h.commit(lane.worktree!, "a.txt", "fixed at the source\n");
  const handed = await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "found and fixed it" });
  assert.equal(handed.ok, true, "the hand-back is not refused — the Peer is told, while it can still put it right");
  assert.match(handed.text, new RegExp(`not on ${task.branch} any more`));
  assert.match(handed.text, /git bisect reset takes it back[^]*left it some other way, say so with ask/, "nothing else it may run puts a copy back");

  h.agents.get(task.peer!)!.status = "idle";
  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(accepted.ok, false, "clean and detached is what the desk used to read as landed");
  assert.match(accepted.text, /nothing committed in it is on its branch[^]*git bisect reset[^]*some other way[^]*raise it with ask/);
  assert.equal(h.git(lane.worktree!, "show", `${lane.branch}:a.txt`), "one\ntwo\nthree\n", "and the lane branch really does not have it");
});

test("a task in the lane's copy whose merge failed still holds that copy, so the next one is not started over it", async () => {
  const { h, lane, peer } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "n", title: "Next", goal: "g", ...scope }] });
  h.commit(lane.worktree!, "new.txt", "new\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "new" });
  h.agents.get(peer)!.status = "idle";
  // Checked out in another copy, the lane branch cannot be moved by the desk, so the merge fails.
  h.git(h.root, "worktree", "add", "-q", join(tempDir("sw2-elsewhere-"), "wt"), lane.branch);
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "failed");
  await h.tick();
  assert.equal(h.ledger().tasks["L1-T2"]!.peer, undefined, "nobody is sent into the copy over it");
  assert.equal(onBranch(h, lane.worktree!), h.ledger().tasks["L1-T1"]!.branch);
});

test("a review of the lane is told where its copy stands: on a task's branch while that task works there, else on the lane branch", async () => {
  const { h, lane } = await laneWithPeer();
  const branch = h.ledger().tasks["L1-T1"]!.branch!;
  const brief = (id: string) => h.agents.get(h.ledger().tasks[id]!.peer!)!.prompt ?? "";
  await h.call(lane.lead!, "lead", "start_review", { focus: "Is the lane sound?" });
  assert.match(brief("L1-R1"), new RegExp(`\\n\\nYour working copy is on ${branch}, where L1-T1 is at work, not ${lane.branch}: read ${lane.branch} itself with git \\(git show ${lane.branch}:<path>, git log ${lane.branch}\\)\\. Read whatever the question needs\\.\\n`));
  await h.call(lane.lead!, "lead", "cut", { task: "L1-T1", reason: "not needed" });
  await h.call(lane.lead!, "lead", "start_review", { focus: "Is the lane sound?" });
  assert.match(brief("L1-R2"), new RegExp(`\\n\\nYour working copy is on ${lane.branch}\\. Read whatever the question needs\\.\\n`));
});

test("a lane dropped while a task holds its copy leaves that task's branch behind only if it holds commits nothing else has", async () => {
  for (const commits of [false, true]) {
    const { h, sup, lane, peer } = await laneWithPeer();
    const task = h.ledger().tasks["L1-T1"]!;
    if (commits) h.commit(lane.worktree!, "new.txt", "new\n");
    for (const id of [lane.lead!, peer]) h.agents.get(id)!.status = "idle";
    const dropped = await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" });
    assert.equal(dropped.ok, true, dropped.text);
    assert.equal(onBranch(h, h.root), "main");
    assert.equal(h.git(h.root, "branch", "--list", task.branch!).trim() !== "", commits);
    assert.equal(dropped.text.includes(`${task.branch} holds commits nothing else has and is kept`), commits);
  }
});

test("a lane in a copy of its own dropped while a task holds it leaves that copy, kept with its Lead, back on the lane branch", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Apart", outcome: "x", ...scope, isolate: true });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", ...scope }] });
  const task = h.ledger().tasks["L1-T1"]!;
  for (const id of [lane.lead!, task.peer!]) h.agents.get(id)!.status = "idle";
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" })).ok, true);
  assert.equal(onBranch(h, lane.worktree!), lane.branch, "its kept Lead reads the lane, not a cut task's work");
  assert.equal(h.git(h.root, "branch", "--list", task.branch!).trim(), "");
});

/** A lane carrying on the Human's branch fix/login, their edit to b.txt uncommitted, with its first task at work there. */
async function onTheirBranch() {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  h.git(h.root, "switch", "-qc", "fix/login");
  writeFileSync(join(h.root, "b.txt"), "bee, still being edited\n");
  await h.call(sup, "supervisor", "open_lane", { title: "Finish", outcome: "x", ...scope, onBranch: true });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Finish it", goal: "g", ...scope }] });
  return { h, sup, lane, task: h.ledger().tasks["L1-T1"]! };
}

test("a task cut on the Human's own branch leaves their uncommitted work as it was, and their copy back on their branch", async () => {
  const { h, lane, task } = await onTheirBranch();
  assert.equal(onBranch(h, h.root), task.branch);
  const cut = await h.call(lane.lead!, "lead", "cut", { task: "L1-T1", reason: "wrong approach" });
  assert.equal(cut.ok, true, cut.text);
  assert.equal(onBranch(h, h.root), "fix/login");
  assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, still being edited\n", "the Human's work is never discarded");
});

test("a lane on the Human's own branch dropped while a task holds it puts their copy back on their branch, their work as it was", async () => {
  const { h, sup, lane, task } = await onTheirBranch();
  for (const id of [lane.lead!, task.peer!]) h.agents.get(id)!.status = "idle";
  const dropped = await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" });
  assert.equal(dropped.ok, true, dropped.text);
  assert.match(dropped.text, /The project's own copy is back on fix\/login\./);
  assert.equal(onBranch(h, h.root), "fix/login");
  assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, still being edited\n");
  assert.equal(h.git(h.root, "branch", "--list", task.branch!).trim(), "");
});

test("the Human's own copy stays on a task's branch, and is said to, when taking it off would lose uncommitted work", async () => {
  for (const how of ["cut", "drop"] as const) {
    const { h, sup, lane, task } = await onTheirBranch();
    h.commit(h.root, "a.txt", "the task's\n");
    writeFileSync(join(h.root, "a.txt"), "the task's, and more\n");
    for (const id of [lane.lead!, task.peer!]) h.agents.get(id)!.status = "idle";
    const said = how === "cut" ? await h.call(lane.lead!, "lead", "cut", { task: "L1-T1", reason: "wrong" }) : await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" });
    assert.equal(said.ok, true, said.text);
    const told = how === "cut" ? "The lane's working copy could not go back on fix/login: [^]*a\\.txt" : `The project's own copy is still on ${task.branch}: git would not take it to fix/login as it stands, and each round tries again\\.`;
    assert.match(said.text, new RegExp(told));
    assert.equal(onBranch(h, h.root), task.branch);
    assert.equal(readFileSync(join(h.root, "a.txt"), "utf-8"), "the task's, and more\n");
    assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, still being edited\n");
  }
});

test("a kept Lead's copy left on a task's branch, a seat being mid-turn at the drop, loses that branch with the copy once released", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Apart", outcome: "x", ...scope, isolate: true });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", ...scope }] });
  const task = h.ledger().tasks["L1-T1"]!;
  h.agents.get(lane.lead!)!.status = "idle";
  const dropped = await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" });
  assert.match(dropped.text, new RegExp(`Its working copy ${lane.slot} stays with its Lead, still on ${task.branch}\\.`), "its Peer was mid-turn there");
  h.agents.get(task.peer!)!.status = "idle";
  await h.endTurn(task.peer!, "done");
  assert.equal((await h.call(sup, "supervisor", "release", { lane: "L1" })).ok, true);
  assert.equal(existsSync(lane.worktree!), false);
  assert.equal(h.git(h.root, "branch", "--list", task.branch!).trim(), "", "nothing of it was only there");
});

test("a task whose copy has work uncommitted is not accepted: only what is committed merges", async () => {
  const { h, lane, peer } = await laneWithPeer();
  h.commit(lane.worktree!, "new.txt", "new\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "new" });
  h.agents.get(peer)!.status = "idle";
  writeFileSync(join(lane.worktree!, "a.txt"), "left behind\n");
  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(accepted.text, "L1-T1's working copy has work uncommitted (M a.txt): send rework asking its Peer to commit what belongs to it, then accept it again.");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "done");
});

test("a merged task sent back works on its branch in the lane's copy again, and not over work left uncommitted there", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const task = h.ledger().tasks["L1-T1"]!;
  h.commit(lane.worktree!, "new.txt", "new\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "new" });
  h.agents.get(peer)!.status = "idle";
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  assert.equal((await h.call(lane.lead!, "lead", "cut", { task: "L1-T1", reason: "late" })).text, "L1-T1 is already merged.");
  assert.equal((await h.call(peer, "peer", "done", { outcome: "complete", summary: "again" })).text, "This task is already merged; there is nothing to hand back.");
  writeFileSync(join(lane.worktree!, "a.txt"), "someone's\n");
  const refused = await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "fix it" });
  assert.equal(refused.text, "The lane's working copy has work uncommitted (M a.txt), so L1-T1 cannot go back onto its branch there. Clear it, then send it back.");
  h.git(lane.worktree!, "checkout", "--", "a.txt");
  assert.equal((await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "fix it" })).ok, true);
  assert.equal(onBranch(h, lane.worktree!), task.branch);
  assert.equal(has(h, lane.worktree!, "HEAD", "new.txt"), true, "its own work is there to fix");
});

test("a lane whose copy a task still holds does not land: the lane branch has none of that task's work", async () => {
  const { h, sup, lane } = await laneWithPeer();
  const branch = h.ledger().tasks["L1-T1"]!.branch;
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(landed.text, `Lane L1 was not closed: its working copy is on ${branch}, L1-T1's branch, not ${lane.branch}. Land it once L1-T1 is merged or cut.`);
  assert.equal(h.ledger().lanes.L1!.status, "open");
});

test("a lane dropped while a Peer is mid-turn in the Human's copy gives it back once that turn ends, and drops that task's branch then", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const task = h.ledger().tasks["L1-T1"]!;
  h.agents.get(lane.lead!)!.status = "idle";
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" })).ok, true);
  assert.equal(onBranch(h, h.root), task.branch, "not switched under the Peer");
  h.agents.get(peer)!.status = "idle";
  await h.endTurn(peer, "done");
  assert.equal(onBranch(h, h.root), "main");
  assert.equal(h.git(h.root, "branch", "--list", task.branch!).trim(), "");
});

test("a lane on the Human's own branch dropped mid-turn gives their copy back on their branch once the turn ends, their work as it was", async () => {
  const { h, sup, lane, task } = await onTheirBranch();
  h.agents.get(lane.lead!)!.status = "idle";
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" })).ok, true);
  assert.equal(onBranch(h, h.root), task.branch, "not switched under the Peer");
  h.agents.get(task.peer!)!.status = "idle";
  await h.endTurn(task.peer!, "done");
  assert.equal(onBranch(h, h.root), "fix/login");
  assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, still being edited\n");
  assert.equal(h.git(h.root, "branch", "--list", task.branch!).trim(), "");
});

test("a task in the lane's copy whose Peer cannot start leaves the copy on the lane branch, and no branch of it behind", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Build", outcome: "x", ...scope });
  const lane = h.ledger().lanes.L1!;
  const paseo = h.paseo as unknown as { workspaces: { ref(id: string): { agents: { create(options: unknown): Promise<unknown> } } } };
  const ref = paseo.workspaces.ref;
  paseo.workspaces.ref = (id) => ({ ...ref(id), agents: { create: async () => Promise.reject(new Error("no seat today")) } });
  const added = await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Work", goal: "g", ...scope }] });
  assert.match(added.text, /The Peer could not start: no seat today/);
  assert.equal(onBranch(h, lane.worktree!), lane.branch);
  assert.equal(h.git(h.root, "branch", "--list", h.ledger().tasks["L1-T1"]!.branch!).trim(), "");
});

test("a task branch is dropped once its work is in the lane's and its Peer is released, whichever branch the project's own copy is on", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  // The lane's own copy keeps the project's copy on main, which is what `git branch -d` would read.
  await h.call(sup, "supervisor", "open_lane", { title: "Apart", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  const lane = h.ledger().lanes.L1!;
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "A", goal: "g", acceptance: ["a"], holds: ["a.txt"], outOfScope: ["the rest of the repository"], parallel: true }] });
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
