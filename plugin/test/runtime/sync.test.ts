import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
const beside = (key: string, title: string, holds: string[]) => ({
  tasks: [{ key, title, goal: "g", ...scope, holds, parallel: true }],
});

test("a task beside others sent back after its merge takes up the lane as it stands now, not the branch it merged from", async () => {
  const { h, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", beside("p", "Prices", ["c.txt"]));
  await h.call(lane.lead!, "lead", "add_tasks", beside("q", "Quotes", ["d.txt"]));
  for (const [id, file] of [
    ["L1-T2", "c.txt"],
    ["L1-T3", "d.txt"],
  ] as const) {
    const task = h.ledger().tasks[id]!;
    h.commit(task.worktree!, file, `${file}\n`);
    await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: file });
    h.agents.get(task.peer!)!.status = "idle";
    await h.call(lane.lead!, "lead", "accept", { task: id });
    await h.runtime.desk.settled(h.project);
  }
  assert.equal((await h.call(lane.lead!, "lead", "rework", { task: "L1-T2", text: "Round the prices." })).ok, true);
  const copy = h.ledger().tasks["L1-T2"]!.worktree!;
  assert.equal(
    h.git(copy, "show", "HEAD:d.txt"),
    "d.txt\n",
    "what merged after it is in its copy before it reads the letter",
  );
});
