import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { harness, laneWithPeer } from "./harness.ts";

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

test("a decision only the Human can make waits in their queue, and what they said in chat goes on record only with their own words", async () => {
  const { h, sup, lane } = await laneWithPeer();
  const asked = await h.call(sup, "supervisor", "ask_human", packet({ lane: "L1", class: "irreversible" }));
  assert.match(
    asked.text,
    /^Asked the Human as H1; it waits in their question queue\. Nothing it decides goes ahead until they answer\. Lane L1 is on hold for it\./,
  );
  assert.equal(
    h.ledger().lanes.L1!.onHold?.reason,
    "it waits for the Human's answer to H1: Delete old invoices, or keep them archived?",
  );
  assert.match(
    (await h.call(sup, "supervisor", "status", {})).text,
    /## Questions for the Human\n\n- H1 \(irreversible, L1\), open 0 min: Delete old invoices, or keep them archived\? Recommended: Archive\. While silent: The lane archives them/,
  );

  const unsaid = await h.call(sup, "supervisor", "record_human_answer", {
    question: "H1",
    choice: "Delete",
    quote: "delete them all",
  });
  assert.match(unsaid.text, /The Human's own words "delete them all" are not in this chat/);
  h.timelineOf(sup).add({ type: "user_message", text: "Hmm.  Archive them,\nplease.", clientMessageId: "app-1" });
  h.timelineOf(sup).add({ type: "user_message", text: "SEEN L1-T1 hand back", clientMessageId: "sw2-handback-1" });
  assert.match(
    (
      await h.call(sup, "supervisor", "record_human_answer", {
        question: "H1",
        choice: "Delete",
        quote: "seen l1-t1 hand back",
      })
    ).text,
    /are not in this chat/,
    "a letter from the desk is not the Human's word",
  );
  // As Paseo rebuilds a history after a daemon restart: every message without its id, the desk's letters too.
  h.timelineOf(sup).add({ type: "user_message", text: "LANDED L1: delete the old invoices" });
  assert.match(
    (
      await h.call(sup, "supervisor", "record_human_answer", {
        question: "H1",
        choice: "Delete",
        quote: "delete the old invoices",
      })
    ).text,
    /are not in this chat/,
    "a message that lost its id may be the desk's",
  );
  assert.match(
    (
      await h.call(sup, "supervisor", "record_human_answer", {
        question: "H1",
        choice: "Keep",
        quote: "archive them, please",
      })
    ).text,
    /Keep is none of H1's options: Delete, Archive, or decline or cancel\./,
  );
  const recorded = await h.call(sup, "supervisor", "record_human_answer", {
    question: "h1",
    choice: "Archive",
    quote: "archive them, please!",
  });
  assert.equal(
    recorded.text,
    "H1 is answered: Archive. Lane L1 is still on hold for it: resume_lane it once the answer is carried into the lane.",
  );
  assert.deepEqual([h.ledger().questions.H1!.status, h.ledger().questions.H1!.answer?.by], ["answered", "chat"]);
  assert.match(
    (
      await h.call(sup, "supervisor", "record_human_answer", {
        question: "H1",
        choice: "decline",
        quote: "archive them",
      })
    ).text,
    /H1 is already answered\./,
  );
  assert.ok(lane.lead);
});

test("a question is put as a choice with a recommendation among its options, and the Human gets no more of them in a day than they allow", async () => {
  const { h, sup } = await laneWithPeer();
  assert.match(
    (await h.call(sup, "supervisor", "ask_human", packet({ recommend: "Shred" }))).text,
    /recommend names none of the options: give one of Delete, Archive\./,
  );
  assert.match(
    (
      await h.call(
        sup,
        "supervisor",
        "ask_human",
        packet({
          options: [
            { label: "Delete", effect: "x" },
            { label: "cancel", effect: "y" },
          ],
          recommend: "Delete",
        }),
      )
    ).text,
    /none called decline or cancel/,
  );
  assert.match(
    (
      await h.call(
        sup,
        "supervisor",
        "ask_human",
        packet({ options: [{ label: "Delete", effect: "x" }], recommend: "Delete" }),
      )
    ).text,
    /options takes at least 2/,
  );
  for (const n of [1, 2, 3])
    assert.match(
      (await h.call(sup, "supervisor", "ask_human", packet())).text,
      new RegExp(`^Asked the Human as H${n};`),
    );
  assert.match(
    (await h.call(sup, "supervisor", "ask_human", packet())).text,
    /The Human has had 3 questions in the last day \(H1, H2, H3\), and 3 is what they allow/,
  );
});

test("a lane that went on without the Human's answer to a costly question stops when it reports ready, and a no is kept apart from an answer", async () => {
  const { h, sup, lane } = await laneWithPeer(undefined, undefined, { holds: ["a.txt"], parallel: true });
  assert.match(
    (await h.call(sup, "supervisor", "ask_human", packet({ lane: "L1", class: "costly" }))).text,
    /stops at its next report of ready if they have not answered by then\./,
  );
  assert.equal(h.ledger().lanes.L1!.onHold, undefined, "nothing stops before the checkpoint");
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
});

test("a costly question about a lane already reported ready stops it now, since its checkpoint has passed", async () => {
  const { h, sup, lane } = await laneWithPeer(undefined, undefined, { holds: ["a.txt"], parallel: true });
  await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  const asked = await h.call(sup, "supervisor", "ask_human", packet({ lane: "L1", class: "costly" }));
  assert.match(
    asked.text,
    /Its lane has already reported ready, so it stops now until they answer\. Lane L1 is on hold for it\./,
  );
  assert.match(h.ledger().lanes.L1!.onHold?.reason ?? "", /waits for the Human's answer to H1/);
});

test("a question about a lane that writes where the Human asked to be asked first is costly at least, whatever it is called", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { askFirst: ["src/auth"] });
  const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["the rest"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Login", ...scope, writeSet: ["src/**"] });
  await h.call(sup, "supervisor", "open_lane", { title: "Session", ...scope, isolate: true });
  const copy = h.ledger().lanes.L2!.worktree!;
  mkdirSync(join(copy, "src", "auth"), { recursive: true });
  h.commit(copy, "src/auth/session.ts", "export const session = 1;\n");

  const declared = await h.call(sup, "supervisor", "ask_human", packet({ lane: "L1" }));
  assert.match(
    declared.text,
    /^Asked the Human as H1; it waits in their question queue\. It is costly, not reversible\. Lane L1 may write under src\/auth, which the Human asked to be asked about first\. The lane goes on/,
  );
  const worked = await h.call(sup, "supervisor", "ask_human", packet({ lane: "L2" }));
  assert.match(
    worked.text,
    /It is costly, not reversible\. Lane L2: It changes src\/auth\/session\.ts, under src\/auth, which the Human asked to be asked about first\./,
  );
  assert.deepEqual([h.ledger().questions.H1!.class, h.ledger().questions.H2!.class], ["costly", "costly"]);
  await h.call(sup, "supervisor", "ask_human", packet({ lane: "L1", class: "irreversible" }));
  assert.equal(h.ledger().questions.H3!.class, "irreversible", "the Supervisor may raise a question, never lower it");
});
