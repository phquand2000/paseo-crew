import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import type { TimelineItem } from "../../server/core/ports.ts";
import { laneWithPeer } from "./harness.ts";

const parser = {
  key: "s",
  title: "Parser",
  goal: "g",
  acceptance: ["a"],
  holds: ["b.txt"],
  outOfScope: ["the rest"],
  parallel: true,
};

test("a Lead widening what a task beside others holds, or turning a task to another goal, wakes whoever supervises; less than that does not", async () => {
  const { h, sup, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [parser] });
  const amend = (args: Record<string, unknown>) =>
    h.call(lane.lead!, "lead", "amend_task", { task: "L1-T2", why: "the parser lives there", ...args });
  for (const change of [
    { acceptance: ["a", "b"] },
    { holds: ["b.txt", "c.txt"] },
    { holds: ["c.txt"] },
    { hints: ["d.txt"], context: "d.txt reads the header" },
    { goal: "parse the header instead" },
  ]) {
    const amended = await amend(change);
    assert.equal(amended.ok, true, amended.text);
  }
  const said = h.heard(sup).join("\n");
  assert.match(
    said,
    /ARCHITECTURE L1-T2 \(Parser\) in L1: its Lead widened what it holds by c\.txt, because the parser lives there/,
  );
  assert.match(
    said,
    /TURNING L1-T2 \(Parser\) in L1: its Lead changed what it is for, because the parser lives there\nwas: g\nnow: parse the header instead/,
  );
  assert.equal(
    said.match(/ARCHITECTURE|TURNING/g)!.length,
    2,
    "new acceptance, holding less, or where to start reading is the Lead's own business",
  );
});

test("a task sent back again and again, gone quiet until it stalls, or stopped on a refused call is its Lead's to settle: whoever supervises hears nothing of it", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const blocked = { outcome: "blocked", summary: "stuck" };
  assert.equal((await h.call(peer, "peer", "done", blocked)).ok, true);
  await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "unblocked, round 1" });
  await h.idle(peer);
  assert.equal((await h.call(peer, "peer", "done", blocked)).ok, true);
  await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "unblocked, round 2" });
  await h.idle(peer);
  assert.equal(
    h
      .heard(peer)
      .join("\n")
      .match(/unblocked, round 2/g)?.length,
    1,
    "each answer to a blocked hand-back reaches its Peer",
  );
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: `not yet, round ${round}` });
  }
  // A turn counts the Peer as heard from when its last record is no older than the turn: this one starts after it.
  const heard = h.ledger().agents[peer]!;
  while (Date.now() <= (heard.recordedAt ?? 0)) await sleep(1);
  const launch: TimelineItem = {
    type: "tool_call",
    name: "Bash",
    status: "completed",
    detail: {
      type: "shell",
      command: "npm run build",
      output: "Command running in background with ID: bk7q2. Output is being written to: /tmp/bk7q2.output",
    },
  };
  const notice: TimelineItem = {
    type: "tool_call",
    name: "task_notification",
    status: "completed",
    detail: { type: "plain_text", label: "Build" },
  };
  for (const [words, calls] of [
    ["Looking at it.", [launch]],
    ["Still looking.", [notice]],
    ["Still.", []],
  ] as const) {
    await h.beginTurn(peer);
    await h.endTurn(peer, words, ...calls);
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled", "what would wake a seat is only recorded yet");
  assert.deepEqual(
    h
      .events("turn.silent")
      .slice(-3)
      .map((event) => event.wouldWait),
    ["background job bk7q2", null, null],
    "a job its harness will report is a wait until the harness says it ended",
  );
  const said = () => h.heard(sup).join("\n");
  assert.doesNotMatch(said(), /L1-T1/);

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [parser] });
  const beside = h.ledger().tasks["L1-T2"]!.peer!;
  await h.beginTurn(beside);
  await h.endTurn(beside, "", {
    type: "tool_call",
    name: "Bash",
    status: "failed",
    error: { content: "Permission to use Bash with command git log has been denied." },
    detail: { type: "shell", command: "git log" },
  });
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "stalled", "a turn that ends on a refused call stalls at once");
  assert.deepEqual(
    h
      .events("turn.silent")
      .map(({ task, denied, refused }) => [task, denied, refused])
      .at(-1),
    ["L1-T2", "Bash: git log", true],
  );
  assert.doesNotMatch(said(), /L1-T2/);
});
