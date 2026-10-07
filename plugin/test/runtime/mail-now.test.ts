import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";
import { heldGit } from "./lane-gates.ts";

test("a message sent now into a hand-back under way stops it being taken, and word that changes nothing does not", async (t) => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  h.agents.get(peer)!.status = "running";
  h.commit(h.ledger().lanes.L1!.worktree!, "a.txt", "round\n");
  let n = 0;
  const done = (summary: string) =>
    h.runtime.answer(
      {
        id: `p${++n}`,
        agent: peer,
        role: "peer",
        tool: "done",
        args: { outcome: "complete", summary },
        cwd: h.root,
        at: Date.now(),
      },
      new AbortController().signal,
    );

  const gate = heldGit("diff");
  t.after(gate.release);
  const first = done("rounded");
  await gate.reached;
  const sent = await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "Check the rates as well.", now: true });
  assert.match(sent.text, /^Delivered to the engineer on L1-T1, cutting its work short/);
  assert.match(
    h.heard(lead).join("\n"),
    /I've written to the engineer on L1-T\d directly, and cut in where they were:\n\n> Check the rates as well\./,
  );
  gate.release();
  const refused = await first;
  assert.equal(refused.ok, false);
  assert.match(refused.text, /^done was not carried out: mail that changes your work came while it ran\./);
  const task = h.ledger().tasks["L1-T1"]!;
  assert.deepEqual(
    [task.status, task.handback],
    ["running", undefined],
    "its Lead is not handed work the message changed",
  );

  const again = heldGit("diff");
  t.after(again.release);
  const second = done("rounded, rates checked");
  await again.reached;
  await h.call(lead, "lead", "add_tasks", {
    tasks: [
      {
        key: "b",
        title: "Side",
        goal: "g",
        acceptance: ["a"],
        hints: ["b.txt"],
        outOfScope: ["x"],
        holds: ["b.txt"],
        parallel: true,
      },
    ],
  });
  again.release();
  const taken = await second;
  assert.equal(taken.ok, true, taken.text);
  assert.match(
    taken.text,
    /Mail held for you:[^]*BESIDE L1-T2/,
    "word it reads with the reply, not a reason to hand back again",
  );
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "done");
});
