import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { harness, laneWithPeer } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
const beside = (key: string, title: string, holds: string[]) => ({ tasks: [{ key, title, goal: "g", ...scope, holds, parallel: true }] });
const letters = (h: ReturnType<typeof harness>, id: string) => h.agents.get(id)!.sent.join("\n");

test("a task beside others is brought up to date with its lane as it hands back, and its gate runs on what the lane would become", async () => {
  const { h, sup, lane } = await laneWithPeer();
  await h.call(sup, "supervisor", "set_project", { gate: "test -f shared.txt", gateOn: "task" });
  await h.call(lane.lead!, "lead", "add_tasks", beside("s", "Side", ["c.txt"]));
  const side = h.ledger().tasks["L1-T2"]!;
  // The lane moves on after the task branched from it.
  h.commitTo(lane.branch, "shared.txt", "from the lane\n");
  h.commit(side.worktree!, "c.txt", "C\n");
  assert.equal((await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" })).ok, true);
  await h.idle(lane.lead!);
  const handback = letters(h, lane.lead!).split("HANDBACK L1-T2")[1] ?? "";
  assert.match(handback, new RegExp(`\\nBrought up to date with ${lane.branch} at [0-9a-f]{7}\\.\\n`));
  assert.match(handback, /\nChanged: c\.txt\n/, "only what the task changed, not what came in with the lane");
  assert.match(handback, /Gate: test -f shared\.txt passed/);
  assert.equal(h.git(side.worktree!, "merge-base", "--is-ancestor", lane.branch, "HEAD").trim(), "");
  assert.equal(h.ledger().tasks["L1-T2"]!.handback!.gate!.sha, h.git(side.worktree!, "rev-parse", "HEAD").trim(), "the commit the gate ran on is on record");
});

test("a hand-back whose lane conflicts with it goes back to its Peer, naming the task that wrote the lane's side, and its Lead is told in passing", async () => {
  const { h, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", beside("p", "Prices", ["c.txt"]));
  await h.call(lane.lead!, "lead", "add_tasks", beside("q", "Quotes", ["d.txt"]));
  await h.call(lane.lead!, "lead", "add_tasks", beside("e", "Else", ["e.txt"]));
  const [first, second, third] = ["L1-T2", "L1-T3", "L1-T4"].map((id) => h.ledger().tasks[id]!);
  h.commit(first!.worktree!, "c.txt", "prices\n");
  h.commit(third!.worktree!, "e.txt", "else\n");
  for (const merging of [first!, third!]) {
    await h.call(merging.peer!, "peer", "done", { outcome: "complete", summary: "done" });
    await h.call(lane.lead!, "lead", "accept", { task: merging.id });
    await h.runtime.desk.settled(h.project);
    assert.equal(h.ledger().tasks[merging.id]!.status, "merged");
  }

  h.commit(second!.worktree!, "c.txt", "quotes\n");
  const refused = await h.call(second!.peer!, "peer", "done", { outcome: "complete", summary: "d, and c" });
  assert.equal(refused.ok, false);
  assert.equal(refused.text, `Not handed back yet: ${lane.branch} has moved on since your branch left it, and bringing it in conflicts in c.txt, changed there by L1-T2. The merge is left in your copy: settle it so both changes stand, commit it with git commit, then call done again.`);
  assert.equal(h.ledger().tasks["L1-T3"]!.status, "running", "nothing is handed back");
  assert.match(h.heard(lane.lead!).join("\n"), new RegExp(`SETTLING L1-T3 \\(Quotes\\): bringing ${lane.branch} into its branch conflicts in c\\.txt, changed there by L1-T2\\. Its Peer settles it in its own copy before it hands back\\.`));

  writeFileSync(join(second!.worktree!, "c.txt"), "prices and quotes\n");
  h.git(second!.worktree!, "add", "c.txt");
  h.git(second!.worktree!, "commit", "-q", "--no-edit");
  assert.equal((await h.call(second!.peer!, "peer", "done", { outcome: "complete", summary: "d, and c settled" })).ok, true);
  assert.equal(h.ledger().tasks["L1-T3"]!.status, "done");
});

test("a task whose copy has work uncommitted hands back as it stands, and says it was not brought up to date", async () => {
  const { h, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", beside("s", "Side", ["c.txt"]));
  const side = h.ledger().tasks["L1-T2"]!;
  h.commitTo(lane.branch, "shared.txt", "from the lane\n");
  writeFileSync(join(side.worktree!, "c.txt"), "not committed\n");
  assert.equal((await h.call(side.peer!, "peer", "done", { outcome: "partial", summary: "c" })).ok, true);
  await h.idle(lane.lead!);
  assert.match(letters(h, lane.lead!), new RegExp(`\\nNot brought up to date with ${lane.branch}: its copy has work uncommitted\\.\\n`));
});

test("a task beside others sent back after its merge takes up the lane as it stands now, not the branch it merged from", async () => {
  const { h, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", beside("p", "Prices", ["c.txt"]));
  await h.call(lane.lead!, "lead", "add_tasks", beside("q", "Quotes", ["d.txt"]));
  for (const [id, file] of [["L1-T2", "c.txt"], ["L1-T3", "d.txt"]] as const) {
    const task = h.ledger().tasks[id]!;
    h.commit(task.worktree!, file, `${file}\n`);
    await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: file });
    h.agents.get(task.peer!)!.status = "idle";
    await h.call(lane.lead!, "lead", "accept", { task: id });
    await h.runtime.desk.settled(h.project);
  }
  assert.equal((await h.call(lane.lead!, "lead", "rework", { task: "L1-T2", text: "Round the prices." })).ok, true);
  const copy = h.ledger().tasks["L1-T2"]!.worktree!;
  assert.equal(h.git(copy, "show", "HEAD:d.txt"), "d.txt\n", "what merged after it is in its copy before it reads the letter");
});

test("a task beside others sent back before its merge is left as its Peer had it: a conflict with its lane is met at its next hand-back, with the reason", async () => {
  const { h, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", beside("s", "Side", ["c.txt"]));
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "side\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  h.commitTo(lane.branch, "c.txt", "lane\n");
  assert.equal((await h.call(lane.lead!, "lead", "rework", { task: "L1-T2", text: "Shorter, please." })).ok, true);
  assert.throws(() => h.git(side.worktree!, "rev-parse", "-q", "--verify", "MERGE_HEAD"), "no merge is begun under it");
});
