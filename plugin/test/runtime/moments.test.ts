import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a Lead widening what a task beside others holds, or turning a task to another goal, wakes whoever supervises; less than that does not", async () => {
  const { h, sup, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", {
    tasks: [
      {
        key: "s",
        title: "Parser",
        goal: "g",
        acceptance: ["a"],
        holds: ["b.txt"],
        outOfScope: ["the rest"],
        parallel: true,
      },
    ],
  });
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

test("a task sent back a second time, or gone quiet until it stalls, wakes whoever supervises once for each", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: `not yet, round ${round}` });
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  for (const words of ["Looking at it.", "Still looking.", "Still."]) {
    h.beginTurn(peer);
    await h.endTurn(peer, words);
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  const said = h.heard(sup).join("\n");
  assert.match(said, /STRUGGLING L1-T1 \(Clean build\) in L1: its Lead sent it back a second time: not yet, round 2/);
  assert.match(said, /STRUGGLING L1-T1 \(Clean build\) in L1: its Peer ended 2 turns without a hand-back or an ask/);
  assert.equal(
    said.match(/STRUGGLING/g)!.length,
    2,
    "a third sending-back, or a third quiet turn, is the same struggle",
  );
});
