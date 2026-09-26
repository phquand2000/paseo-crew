import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { contracts } from "../../shared/rpc.ts";
import { harness, laneWithPeer, repo } from "./harness.ts";

const packet = (extra: Record<string, unknown> = {}) => ({
  question: "Delete old invoices, or keep them archived?",
  why: "It decides whether customers' records can come back.",
  options: [
    { label: "Delete", effect: "Invoices older than 7 years are gone for good." },
    { label: "Archive", effect: "They move to cold storage and can be restored." },
  ],
  recommend: "Archive",
  reason: "Nothing is lost, and storage costs little.",
  ifSilent: "The lane archives them, which can be undone.",
  class: "reversible",
  ...extra,
});

test("a question's class decides what waits on it: an irreversible one holds its lane now, a costly one at its ready report, and the Human's standing orders raise it", async () => {
  const { h, sup, lane } = await laneWithPeer({ attention: { questionsPerDay: 6 } }, undefined, {
    holds: ["a.txt"],
    parallel: true,
  });
  const ask = (extra: Record<string, unknown>) => h.call(sup, "supervisor", "ask_human", packet(extra));
  assert.match(
    (await ask({ lane: "L1", class: "costly" })).text,
    /stops at its next report of ready if they have not answered by then\./,
  );
  assert.equal(h.ledger().lanes.L1!.onHold, undefined);
  await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  assert.match(
    h.ledger().lanes.L1!.onHold?.reason ?? "",
    /went on without the Human's answer to H1, and stops at its ready report until they answer/,
  );
  await h.idle(sup);
  assert.match(
    h.agents.get(sup)!.sent.join("\n"),
    /REPORT L1 \(Build\): ready to land\n\nIt is on hold: it went on without the Human's answer to H1/,
  );
  h.timelineOf(sup).add({ type: "user_message", text: "No. Don't touch invoices at all.", clientMessageId: "app-2" });
  assert.match(
    (await h.call(sup, "supervisor", "record_human_answer", { question: "H1", choice: "decline", quote: "no" })).text,
    /^H1 is declined: decline\. Lane L1 is still on hold for it/,
  );
  await h.call(sup, "supervisor", "resume_lane", { lane: "L1" });
  assert.match(
    (await ask({ lane: "L1", class: "costly" })).text,
    /Its lane has already reported ready, so it stops now until they answer\. Lane L1 is on hold for it\./,
  );
  assert.match(h.ledger().lanes.L1!.onHold?.reason ?? "", /waits for the Human's answer to H2/);

  await h.call(sup, "supervisor", "set_project", { askFirst: ["src/auth"] });
  const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["the rest"], isolate: true };
  await h.call(sup, "supervisor", "open_lane", { title: "Login", ...scope, writeSet: ["src/**"] });
  await h.call(sup, "supervisor", "open_lane", { title: "Session", ...scope });
  const copy = h.ledger().lanes.L3!.worktree!;
  mkdirSync(join(copy, "src", "auth"), { recursive: true });
  h.commit(copy, "src/auth/session.ts", "export const session = 1;\n");
  assert.match(
    (await ask({ lane: "L2" })).text,
    /^Asked the Human as H3; it waits in their question queue\. It is costly, not reversible\. Lane L2 may write under src\/auth, which the Human asked to be asked about first\. The lane goes on/,
  );
  assert.match(
    (await ask({ lane: "L3" })).text,
    /It is costly, not reversible\. Lane L3: It changes src\/auth\/session\.ts, under src\/auth, which the Human asked to be asked about first\./,
  );
  await ask({ lane: "L2", class: "irreversible" });
  assert.deepEqual(
    ["H3", "H4", "H5"].map((id) => h.ledger().questions[id]!.class),
    ["costly", "costly", "irreversible"],
  );
});

test("the Human's daily allowance of questions counts every project, on the Report and when a question is asked", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const elsewhere = repo().root;
  const theirs = h.add("sw2-supervisor-claude/claude-opus-5", elsewhere, "sup-b");
  assert.match((await h.call(theirs, "supervisor", "ask_human", packet(), elsewhere)).text, /^Asked the Human as H1;/);
  assert.match((await h.call(sup, "supervisor", "ask_human", packet())).text, /^Asked the Human as H1;/);
  const report = await h.rpc(contracts.report, { project: h.project.slug });
  assert.ok("numbers" in report);
  assert.deepEqual(report.numbers[0], { title: "Questions today", value: "2 of 3", detail: "across every project" });
  assert.match((await h.call(sup, "supervisor", "ask_human", packet())).text, /^Asked the Human as H2;/);
  assert.match(
    (await h.call(sup, "supervisor", "ask_human", packet())).text,
    /The Human has had 3 questions in the last day \([^)]*\), and 3 is what they allow/,
  );
});
