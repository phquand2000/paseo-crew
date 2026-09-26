import assert from "node:assert/strict";
import { test } from "node:test";
import { saveIncidents } from "../../server/desk/store/incidents.ts";
import { laneWithPeer } from "./harness.ts";

const quote = "the same action failing 3 times: Bash: npm test";

test("nothing reaches a seat that names or quotes an open incident about it, while its own words about the work do", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const now = Date.now();
  const about = (id: string, seat: string) => ({
    id,
    seat,
    where: "L1",
    kind: "stuck",
    level: "attend" as const,
    quote,
    facts: ["stuck"],
    opened: now,
    last: now,
    count: 1,
    open: true,
  });
  saveIncidents(h.project.state, { next: 3, items: { I1: about("I1", peer), I2: about("I2", lane.lead!) } });
  const refusal = /That repeats incident I1 about the seat it goes to/;

  assert.match(
    (await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: "About i1: why did that happen?" })).text,
    refusal,
  );
  assert.match(
    (await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: `You hit ${quote.toUpperCase()}.` })).text,
    refusal,
  );
  assert.match(
    (await h.call(lane.lead!, "lead", "amend_task", { task: "L1-T1", why: `because of ${quote}`, goal: "g2" })).text,
    refusal,
  );
  assert.match((await h.call(sup, "supervisor", "message", { to: "L1-T1", text: `See I1.` })).text, refusal);
  assert.match(
    (await h.call(sup, "supervisor", "message", { to: "L1", text: `${quote}?` })).text,
    /That repeats incident I2/,
  );
  assert.match(
    (
      await h.call(sup, "supervisor", "amend_lane", {
        lane: "L1",
        why: "the Human changed it",
        acceptance: [`no more ${quote}`],
      })
    ).text,
    /That repeats incident I2/,
  );
  assert.equal(
    (
      await h.call(lane.lead!, "lead", "message", {
        to: "L1-T1",
        text: "Your test run keeps failing the same way; what does the first failure say?",
      })
    ).ok,
    true,
  );

  await h.call(peer, "peer", "ask", { question: "Which rounding?", bestGuess: "half up" });
  assert.match((await h.call(lane.lead!, "lead", "answer", { ask: "A1", text: "Half up. Also I1." })).text, refusal);
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  assert.match((await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: `Stop: ${quote}.` })).text, refusal);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "done", "a refused rework sends the task nowhere");
});
