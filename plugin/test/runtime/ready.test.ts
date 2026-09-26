import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a READY is what the lane's copy holds with nobody writing there, and whatever changes the lane takes it away", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const copy = lane.worktree!;
  const report = (ready = true) => h.call(lead, "lead", "report", { summary: "done", ready });
  const ready = () => h.ledger().lanes.L1!.ready;
  /** A task beside the lane's copy holding `file`, handed back with it committed. */
  const beside = async (key: string, file: string) => {
    const tasks = [
      { key, title: key, goal: "g", acceptance: ["c"], holds: [file], outOfScope: ["the rest"], parallel: true },
    ];
    await h.call(lead, "lead", "add_tasks", { tasks });
    const task = Object.values(h.ledger().tasks).find((entry) => entry.title === key)!;
    h.commit(task.worktree!, file, `${file}\n`);
    await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: file });
    h.agents.get(task.peer!)!.status = "idle";
    return task;
  };

  const writing = new RegExp(
    `^${peer} is mid-turn in the lane's working copy, so what ready claims could still change under the gate\\. Report ready once that turn ends\\.$`,
  );
  const refused = await report();
  assert.equal(refused.ok, false);
  assert.match(refused.text, writing);
  assert.equal(ready(), undefined);
  assert.equal((await report(false)).ok, true);
  await h.idle(peer);
  const seats = (h.paseo as { agents: { ref: (id: string) => { refresh: () => Promise<unknown> } } }).agents;
  const ref = seats.ref;
  seats.ref = (id) => {
    const handle = ref(id);
    if (id !== peer) return handle;
    seats.ref = ref;
    return Object.assign(Object.create(handle) as typeof handle, {
      refresh: () => Promise.reject(new Error("the daemon did not answer")),
    });
  };
  assert.match((await report()).text, new RegExp(`^${peer} is mid-turn in the lane's working copy`));
  const branch = h.ledger().tasks["L1-T1"]!.branch!;
  assert.match(
    (await report()).text,
    new RegExp(
      `^The lane's working copy is on ${branch}, L1-T1's branch, not ${lane.branch}: the gate would read L1-T1's tree\\. Report ready once it is merged or cut\\.$`,
    ),
  );
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "nothing to change" });
  await h.idle(peer);
  await h.call(lead, "lead", "accept", { task: "L1-T1" });
  assert.equal((await report()).ok, true);
  assert.ok(ready());

  const side = await beside("Side", "c.txt");
  assert.equal(ready(), undefined);
  assert.equal((await report()).ok, true);
  await h.call(lead, "lead", "accept", { task: side.id });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks[side.id]!.status, "merged");
  assert.equal(ready(), undefined);

  await h.call(sup, "supervisor", "set_project", { gate: "test -f c.txt", gateOn: "lane" });
  const late = await beside("Late", "d.txt");
  writeFileSync(join(copy, "a.txt"), "being written\n");
  await h.call(lead, "lead", "accept", { task: late.id });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks[late.id]!.status, "queued");
  h.git(copy, "checkout", "--", "a.txt");
  assert.equal((await report()).ok, true);
  assert.equal(h.ledger().tasks[late.id]!.status, "merged");
  assert.match(h.heard(sup).join("\n"), /test -f c\.txt passed on the lane branch/);
});
