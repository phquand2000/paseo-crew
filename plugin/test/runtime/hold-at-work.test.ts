import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };

test("a Lead holds a Peer at work until another task lands: its quiet turns are no silence, and it is told once to go on", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Two", outcome: "x", ...scope, writeSet: ["*.txt"] });
  const lead = h.ledger().lanes.L1!.lead!;
  const tasks = [
    { key: "a", title: "Api", goal: "g", ...scope, holds: ["b.txt"], parallel: true },
    { key: "u", title: "User", goal: "g", ...scope, holds: ["c.txt"], parallel: true },
  ];
  await h.call(lead, "lead", "add_tasks", { tasks });
  const task = (id: string) => h.ledger().tasks[id]!;
  const [api, user] = [task("L1-T1").peer!, task("L1-T2").peer!];
  const heard = (id: string) => h.heard(id).join("\n");
  const turn = async (said: string) => {
    h.runtime.outbox.turnEnded(user);
    await new Promise((resolve) => setTimeout(resolve, 3));
    await h.beginTurn(user);
    await h.endTurn(user, said);
  };
  const reorder = (id: string, after: string[]) =>
    h.call(lead, "lead", "amend_task", { task: id, why: "it builds on the API", after });
  h.agents.get(user)!.status = "idle";

  const asked = await h.call(user, "peer", "ask", { question: "Build on the API first?", tried: "read both" });
  assert.equal(asked.ok, true, asked.text);
  const held = await reorder("L1-T2", ["l1-t1"]);
  assert.match(held.text, /L1-T2 is amended; its Peer waits for L1-T1 unnudged, and is told when they land/);
  await h.call(lead, "lead", "answer", { ask: "A1", text: "Yes: wait for L1-T1." });
  assert.match(
    (await reorder("L1-T1", ["L1-T2"])).text,
    /L1-T1 would wait for itself through L1-T2, so it could never go on/,
  );

  await turn("Waiting for L1-T1.");
  assert.match(heard(user), /AMENDED L1-T2[^]*Next: Wait for L1-T1: stop and leave your work as it is/);
  await turn("Still waiting.");
  assert.deepEqual([task("L1-T2").status, task("L1-T2").silent], ["running", 0], "held, its quiet turns are waiting");
  assert.doesNotMatch(heard(user), /without calling done or ask/);
  await h.idle(lead);
  await h.idle(sup);
  assert.doesNotMatch(heard(lead), /SILENT L1-T2/);

  h.commit(task("L1-T1").worktree!, "b.txt", "api\n");
  assert.equal((await h.call(api, "peer", "done", { outcome: "complete", summary: "api" })).ok, true);
  await h.call(lead, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  assert.equal(task("L1-T1").status, "merged");
  await h.tick();
  await turn("Told to go on, and did nothing.");
  assert.equal(heard(user).match(/GO ON L1-T2 \(User\): L1-T1 merged, what your Lead had you wait for\./g)?.length, 1);
  assert.equal(task("L1-T2").held, undefined);
  assert.equal(task("L1-T2").silent, 1, "let go, its quiet turns count again");
  assert.match((await reorder("L1-T2", ["L1-T1"])).text, /L1-T1 merged already; L1-T2 has nothing of it to wait for/);

  h.commit(task("L1-T2").worktree!, "c.txt", "user\n");
  assert.equal((await h.call(user, "peer", "done", { outcome: "complete", summary: "user" })).ok, true);
  assert.match(
    (await reorder("L1-T2", ["L1-T1"])).text,
    /L1-T2 is done; after orders a task still waiting to start, or one its Peer is at work on/,
  );
});
