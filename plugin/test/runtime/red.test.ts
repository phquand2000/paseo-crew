import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../tempdir.ts";
import { harness, laneWithPeer } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
const beside = (key: string, title: string, holds: string[]) => ({ tasks: [{ key, title, goal: "g", ...scope, holds, parallel: true }] });
const letters = (h: ReturnType<typeof harness>, id: string) => h.agents.get(id)!.sent.join("\n");

/** Two tasks beside each other, each green alone and red together, both handed back before either merges. */
async function twoThatBreakTogether() {
  const { h, sup, lane } = await laneWithPeer();
  await h.call(sup, "supervisor", "set_project", { gate: "test ! -f x.txt || test ! -f y.txt", gateOn: "task" });
  await h.call(lane.lead!, "lead", "add_tasks", beside("x", "Ex", ["x.txt"]));
  await h.call(lane.lead!, "lead", "add_tasks", beside("y", "Why", ["y.txt"]));
  for (const [id, file] of [["L1-T2", "x.txt"], ["L1-T3", "y.txt"]] as const) {
    const task = h.ledger().tasks[id]!;
    h.commit(task.worktree!, file, `${file}\n`);
    assert.equal((await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: file })).ok, true);
    h.agents.get(task.peer!)!.status = "idle";
  }
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  return { h, sup, lane };
}

test("a task whose gate goes red once its lane is brought in again at merge leaves the lane branch as it was, and goes back to its Lead", async () => {
  const { h, lane } = await twoThatBreakTogether();
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T3" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T3"]!.status, "done", "back with its Lead, not merged");
  assert.throws(() => h.git(lane.worktree!, "show", "HEAD:y.txt"), "the lane branch never took the red tree");
  const copy = h.ledger().tasks["L1-T3"]!.worktree!;
  assert.equal(h.git(copy, "show", "HEAD:x.txt"), "x.txt\n", "its own copy holds the tree the lane would have become, for its Peer to see");
  await h.idle(lane.lead!);
  assert.match(letters(h, lane.lead!), new RegExp(`MERGE RED L1-T3 \\(Why\\): the gate failed on its branch with ${lane.branch} brought in, the tree the lane would become\\. The lane branch is unchanged\\.\\n[^]*Next: Send rework to its Peer with what must change, or accept it again with overGate and a reason to merge it over the gate\\.`));
});

test("a red task is accepted again only over its gate, with a reason, and then merges saying so", async () => {
  const { h, lane } = await twoThatBreakTogether();
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T3" });
  await h.runtime.desk.settled(h.project);
  const refused = await h.call(lane.lead!, "lead", "accept", { task: "L1-T3" });
  assert.equal(refused.ok, false);
  assert.match(refused.text, /^L1-T3's gate is red on the tree the lane would become: send it back with rework, or accept it with overGate and a reason to merge it over the gate\./);
  assert.match((await h.call(lane.lead!, "lead", "accept", { task: "L1-T3", overGate: true })).text, /Say why in reason/);
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T3", overGate: true, reason: "y replaces x next task" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T3"]!.status, "merged");
  assert.equal(h.git(lane.worktree!, "show", "HEAD:y.txt"), "y.txt\n");
  await h.idle(lane.lead!);
  assert.match(letters(h, lane.lead!).split("MERGED L1-T3")[1] ?? "", /Gate: ran on this task: test ! -f x\.txt \|\| test ! -f y\.txt: the gate failed with exit 1 — merged over it: y replaces x next task/);
  const events = readFileSync(join(h.project.state, "events.log"), "utf-8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.kind === "gate.overridden" && event.task === "L1-T3" && event.reason === "y replaces x next task"));
});

test("a task whose lane has not moved since its hand-back merges on that verdict, and the gate does not run again", async () => {
  const runs = join(tempDir("sw2-gate-runs-"), "runs");
  const { h, sup, lane } = await laneWithPeer();
  await h.call(sup, "supervisor", "set_project", { gate: `echo run >> ${runs}`, gateOn: "task" });
  await h.call(lane.lead!, "lead", "add_tasks", beside("s", "Side", ["c.txt"]));
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "C\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  h.agents.get(side.peer!)!.status = "idle";
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(readFileSync(runs, "utf-8"), "run\n");
});

test("a task beside others is accepted only once handed back, since what it merges is what was gated", async () => {
  const { h, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", beside("s", "Side", ["c.txt"]));
  const refused = await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" });
  assert.equal(refused.text, "L1-T2 is not handed back: accept it once its Peer hands it back, or cut it.");
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "running");
});

test("a merge waits while the task's own copy cannot take its lane in, and names the tasks that wrote the lane's side of a conflict", async () => {
  const { h, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", beside("p", "Prices", ["c.txt"]));
  await h.call(lane.lead!, "lead", "add_tasks", beside("q", "Quotes", ["d.txt"]));
  const [first, second] = ["L1-T2", "L1-T3"].map((id) => h.ledger().tasks[id]!);
  // Both hand back before either merges; the second also wrote what the first holds.
  h.commit(first!.worktree!, "c.txt", "prices\n");
  h.commit(second!.worktree!, "c.txt", "quotes\n");
  for (const task of [first!, second!]) {
    await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "done" });
    h.agents.get(task.peer!)!.status = "idle";
  }
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  writeFileSync(join(second!.worktree!, "scratch.txt"), "left behind\n");
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T3" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T3"]!.status, "queued");
  assert.match(h.ledger().tasks["L1-T3"]!.held?.why ?? "", new RegExp(`^its own copy cannot take ${lane.branch} in: its copy has work uncommitted$`));

  rmSync(join(second!.worktree!, "scratch.txt"));
  await h.runtime.desk.resumeMerges(h.project);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T3"]!.status, "rework");
  await h.idle(lane.lead!);
  assert.match(letters(h, lane.lead!), new RegExp(`MERGE CONFLICT L1-T3 \\(Quotes\\) with ${lane.branch}\\.\\nFiles: c\\.txt, changed there by L1-T2\\n`));
});

test("a commit made in the lane's copy while a merge's gate ran fails that merge rather than take a tree nobody gated, and the next accept brings it in", async () => {
  const marker = join(tempDir("sw2-race-"), "armed");
  const { h, sup, lane } = await laneWithPeer();
  const race = `if [ -f ${marker} ]; then rm ${marker}; cd ${lane.worktree} && printf 'lane\\n' > c.txt && git add c.txt && git -c user.name=t -c user.email=t@x commit -qm race; fi`;
  await h.call(sup, "supervisor", "set_project", { gate: race, gateOn: "task" });
  await h.call(lane.lead!, "lead", "add_tasks", beside("s", "Side", ["c.txt"]));
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "side\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  h.agents.get(side.peer!)!.status = "idle";
  // The lane moves, so the merge gates again; this time the gate's run sees a commit land in the lane's copy.
  h.commit(lane.worktree!, "shared.txt", "moved\n");
  writeFileSync(marker, "");
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "failed");
  assert.equal(h.git(lane.worktree!, "status", "--porcelain").trim(), "", "the merge is undone");
  await h.idle(lane.lead!);
  assert.match(letters(h, lane.lead!), /MERGE FAILED L1-T2 \(Side\): the lane's copy took a commit while it was gated, which conflicts with it in c\.txt; accepting it again brings that in first/);
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "rework", "the commit came into its copy, conflicts and all, for its Peer");
});
