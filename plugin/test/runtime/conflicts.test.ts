import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { harness } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };

const underWay = (h: Harness, copy: string) =>
  existsSync(join(h.git(copy, "rev-parse", "--absolute-git-dir").trim(), "MERGE_HEAD"));

test("a base that conflicts with a lane leaves nothing mid-merge in the lane's copy: a task takes it in on its own branch, measured by what its Peer changed, and a cut one gives the copy back", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  const land = (lane: string) => h.call(sup, "supervisor", "land_lane", { lane });
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  await h.call(sup, "supervisor", "open_lane", {
    title: "Cart",
    outcome: "x",
    ...scope,
    writeSet: ["a.txt"],
    isolate: true,
  });
  await h.call(sup, "supervisor", "open_lane", { title: "Bees", outcome: "x", ...scope, writeSet: ["b.txt"] });
  const [cart, bees] = [h.ledger().lanes.L1!, h.ledger().lanes.L2!];
  const copy = cart.worktree!;
  const lead = cart.lead!;
  for (const [lane, file, text] of [
    [cart, "a.txt", "one\nlane side\nthree\n"],
    [bees, "b.txt", "lane side\n"],
  ] as const) {
    h.commit(lane.worktree!, file, text);
    await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
    h.agents.get(lane.lead!)!.status = "idle";
  }
  h.commitTo("main", "a.txt", "one\nmain side\nthree\n");
  h.commitTo("main", "outside.txt", "main only\n");
  h.commitTo("main", "b.txt", "main side\n");
  const onBranch = () => h.git(copy, "branch", "--show-current").trim();

  const refused = await land("L1");
  assert.equal(refused.ok, false, refused.text);
  assert.match(
    refused.text,
    /Lane L1 was not closed: main has moved on and conflicts with lane\/l1-cart in a\.txt\. Nothing was left in the lane's copy, and its Lead has a letter to have a task take main in/,
  );
  assert.deepEqual([underWay(h, copy), onBranch()], [false, cart.branch]);
  assert.equal(h.ledger().lanes.L1!.ready, undefined);
  await h.idle(lead);
  assert.match(
    h.agents.get(lead)!.sent.join("\n"),
    /BASE CONFLICT L1 \(Cart\): main moved on, and merging it into lane\/l1-cart conflicts in a\.txt\. Nothing was left in your working copy, and the lane does not land until it takes main in\.\n\nNext: add_tasks a task with takeBase true/,
  );

  const taking = (key: string, extra = {}) =>
    h.call(lead, "lead", "add_tasks", {
      tasks: [{ key, title: key, goal: "take main in", ...scope, takeBase: true, ...extra }],
    });
  assert.match(
    (await taking("p", { parallel: true, holds: ["a.txt"] })).text,
    /P takes main in, which reaches files every task beside it holds: run it in the lane's copy\./,
  );
  const started = (id: string) => {
    const task = h.ledger().tasks[id]!;
    assert.equal(task.status, "running", id);
    assert.deepEqual([onBranch(), underWay(h, copy)], [task.branch, true]);
    assert.match(
      h.agents.get(task.peer!)!.prompt ?? "",
      /The desk merged main into your branch and stopped on conflicts in a\.txt: settling them is this task's work, wherever they are; settle so both sides stand and commit with git commit --no-edit\./,
    );
    return task;
  };
  await taking("c");
  const cut = started("L1-T1");
  await h.idle(cut.peer!);
  assert.match((await h.call(lead, "lead", "cut", { task: "L1-T1", reason: "again" })).text, /back on lane\/l1-cart/);
  assert.deepEqual([onBranch(), underWay(h, copy)], [cart.branch, false]);

  await taking("t");
  const take = started("L1-T2");
  writeFileSync(join(copy, "a.txt"), "one\nboth sides\nthree\n");
  h.git(copy, "add", "a.txt");
  h.git(copy, "commit", "-q", "--no-edit");
  assert.equal((await h.call(take.peer!, "peer", "done", { outcome: "complete", summary: "settled" })).ok, true);
  const handback = h.heard(lead).join("\n").split("HANDBACK L1-T2")[1] ?? "";
  assert.match(handback, /\nChanged: a\.txt\n/, "what its Peer changed, not what main brought in");
  assert.match(handback, /\nNote: settled from merging main: a\.txt\./);
  assert.doesNotMatch(handback, /outside/);
  h.agents.get(take.peer!)!.status = "idle";
  await h.call(lead, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  await h.call(lead, "lead", "report", { summary: "settled", ready: true });
  const landed = await land("L1");
  assert.equal(landed.ok, true, landed.text);
  assert.deepEqual(
    ["a.txt", "outside.txt"].map((file) => h.git(h.root, "show", `main:${file}`)),
    ["one\nboth sides\nthree\n", "main only\n"],
  );

  assert.match((await land("L2")).text, /conflicts with lane\/l2-bees in b\.txt/);
  assert.equal(underWay(h, h.root), false);
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L2", reason: "not wanted after all" })).ok, true);
  await h.idle(bees.lead!);
  await h.runtime.desk.settled(h.project);
  await h.tick();
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
  assert.equal(h.git(h.root, "status", "--porcelain"), "");
  assert.equal(h.git(h.root, "show", "lane/l2-bees:b.txt"), "lane side\n");
});

test("the merge queue hands a conflict to its Peer, merges nothing as nothing, waits out a busy copy or a hold, fails a task on a crash, and is tried once more by landing", async (t) => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Two", outcome: "x", ...scope, writeSet: ["*.txt"] });
  const lane = h.ledger().lanes.L1!;
  const lead = lane.lead!;
  const copy = lane.worktree!;
  const status = (id: string) => h.ledger().tasks[id]!.status;
  /** A task beside the lane's copy, holding `file`, handed back with `text` committed there unless it is undefined. */
  const beside = async (key: string, title: string, file: string, text?: string) => {
    const tasks = [{ key, title, goal: "g", ...scope, holds: [file], parallel: true }];
    await h.call(lead, "lead", "add_tasks", { tasks });
    const task = Object.values(h.ledger().tasks).find((entry) => entry.title === title)!;
    if (text !== undefined) h.commit(task.worktree!, file, text);
    await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: title });
    h.agents.get(task.peer!)!.status = "idle";
    return task;
  };
  const accept = async (task: string) => {
    await h.call(lead, "lead", "accept", { task });
    await h.runtime.desk.settled(h.project);
  };

  const first = await beside("b", "B", "b.txt", "task side\n");
  h.commit(copy, "b.txt", "lane side\n");
  await accept("L1-T1");
  assert.equal(status("L1-T1"), "done");
  assert.doesNotMatch(h.heard(first.peer!).join("\n"), /MERGE CONFLICT|REWORK/);
  assert.equal(h.git(copy, "show", "HEAD:b.txt"), "lane side\n");
  assert.ok(underWay(h, first.worktree!));
  await h.idle(lead);
  assert.match(
    h.agents.get(lead)!.sent.join("\n"),
    /MERGE CONFLICT L1-T1 \(B\) with lane\/l1-two\.\nFiles: b\.txt\nThe lane branch is unchanged\. The desk began merging lane\/l1-two into the task's branch in its own copy and left the conflicts there\.\n\nNext: Send rework asking its Peer to settle them and commit the merge with git commit/,
  );
  writeFileSync(join(first.worktree!, "b.txt"), "both sides\n");
  h.git(first.worktree!, "commit", "-qam", "Settle the lane into the task");
  await h.call(first.peer!, "peer", "done", { outcome: "complete", summary: "settled" });
  await accept("L1-T1");
  assert.equal(status("L1-T1"), "merged");
  assert.equal(h.git(copy, "show", "HEAD:b.txt"), "both sides\n");
  await h.idle(lead);
  assert.match(
    h.agents.get(lead)!.sent.at(-1) ?? "",
    /MERGED L1-T1 \(B\) into the lane branch\.[^]*Next: Every task of the lane is settled/,
  );

  const look = await beside("l", "Look", "d.txt");
  const tip = h.git(copy, "rev-parse", lane.branch);
  await accept("L1-T2");
  assert.equal(status("L1-T2"), "merged");
  assert.equal(h.git(copy, "rev-parse", lane.branch), tip);
  await h.idle(lead);
  assert.match(
    h.agents.get(lead)!.sent.at(-1) ?? "",
    /MERGED L1-T2 \(Look\): it changed no files, so there was nothing to merge\./,
  );
  assert.equal(h.agents.get(look.peer!)!.archivedAt, null);

  const merges = (h.runtime.desk as unknown as { services: { merges: { merge: { run: () => Promise<void> } } } })
    .services.merges;
  const crashing = t.mock.method(merges.merge, "run", () => Promise.reject(new Error("the disk is full")));
  await beside("c", "Crash", "e.txt", "E\n");
  await accept("L1-T3");
  crashing.mock.restore();
  assert.equal(status("L1-T3"), "failed");
  assert.match(
    h.heard(lead).join("\n"),
    /MERGE FAILED L1-T3 \(Crash\): the merge stopped on an error: the disk is full\.\nThe lane branch is unchanged\./,
  );
  assert.deepEqual(
    h.events("merge.failed").map((event) => event.task),
    ["L1-T3"],
  );

  const side = await beside("s", "Side", "c.txt", "C\n");
  writeFileSync(join(copy, "a.txt"), "half written\n");
  await accept("L1-T4");
  assert.equal(status("L1-T4"), "queued");
  const waits = () =>
    h
      .heard(lead)
      .join("\n")
      .match(/MERGE WAITS L1-T4/g)?.length;
  assert.match(
    h.heard(lead).join("\n"),
    /MERGE WAITS L1-T4 \(Side\): the lane's working copy has uncommitted changes \(M a\.txt\)\. It merges by itself once that clears, tried again as each turn ends\.\n\nNext: Have what is left there committed or cleared, or cut the task to withdraw it\./,
  );
  await h.endTurn(lead, "nothing yet");
  await h.runtime.desk.settled(h.project);
  assert.deepEqual([status("L1-T4"), waits()], ["queued", 1]);
  await h.call(sup, "supervisor", "hold_lane", { lane: "L1", reason: "a page came in" });
  h.git(copy, "checkout", "--", "a.txt");
  await h.endTurn(side.peer!, "nothing");
  await h.runtime.desk.settled(h.project);
  assert.equal(status("L1-T4"), "queued");
  await h.call(sup, "supervisor", "resume_lane", { lane: "L1" });
  await h.runtime.desk.settled(h.project);
  assert.deepEqual([status("L1-T4"), h.ledger().tasks["L1-T4"]!.held], ["merged", undefined]);
  assert.equal(h.git(copy, "show", "HEAD:c.txt"), "C\n");

  await beside("f", "Last", "f.txt", "F\n");
  writeFileSync(join(copy, "a.txt"), "half written\n");
  await accept("L1-T5");
  assert.equal(status("L1-T5"), "queued");
  h.git(copy, "checkout", "--", "a.txt");
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(landed.ok, true, landed.text);
  assert.equal(status("L1-T5"), "merged");
  assert.equal(h.git(h.root, "show", "main:f.txt"), "F\n");
});
