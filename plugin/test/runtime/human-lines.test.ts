import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "./harness.ts";

const question = {
  question: "Round totals half up, or to even?",
  why: "It decides what a customer pays.",
  options: [
    { label: "Half up", effect: "0.5 rounds up." },
    { label: "Even", effect: "0.5 rounds to the even cent." },
  ],
  recommend: "Half up",
  reason: "It is what receipts show today.",
  ifSilent: "The lane rounds half up, which can be undone.",
  class: "reversible",
};

test("a lane's lines the Human asked for reach its Lead marked with their word, and one changed without it is told until it lands", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  h.timelineOf(sup).add({ type: "user_message", text: "The tax must show on the receipt.", clientMessageId: "app-1" });
  const lane = {
    title: "Tax",
    outcome: "a.txt changes",
    acceptance: ["tax shows on the receipt", "totals round half up"],
    outOfScope: ["payments"],
  };
  const open = (human: unknown[]) => h.call(sup, "supervisor", "open_lane", { ...lane, human });
  assert.match(
    (await open([{ line: "tax shows on the receipt", quote: "tax on every line" }])).text,
    /The Human's words "tax on every line" are not in this chat/,
  );
  assert.match(
    (await open([{ line: "tax shows", quote: "the tax must show" }])).text,
    /"tax shows" is not a line of the lane's acceptance or out of scope/,
  );
  assert.equal(h.ledger().lanes.L1, undefined);

  await open([{ line: "tax shows on the receipt", quote: "the tax must show on the receipt" }]);
  const lead = h.ledger().lanes.L1!.lead!;
  assert.match(
    h.agents.get(lead)!.prompt ?? "",
    /Acceptance:\n- tax shows on the receipt \(the Human's, "the tax must show on the receipt"\)\n- totals round half up\n[^]*A line marked the Human's is their own ask\. Any other is a choice made for them/,
  );

  const amended = await h.call(sup, "supervisor", "amend_lane", {
    lane: "L1",
    why: "checkout shows it first",
    acceptance: ["tax shows at checkout", "totals round half up"],
  });
  assert.match(
    amended.text,
    /It changes what the Human asked for without their word: "tax shows on the receipt"\. Tell them, or put it to them with ask_human\.$/,
  );
  assert.match(
    h.heard(lead).join("\n"),
    /AMENDED L1 \(Tax\)[^]*The Human asked for these, and this changes them without their word:\n- tax shows on the receipt \(the Human's, "the tax must show on the receipt"\)/,
  );

  await h.call(sup, "supervisor", "ask_human", question);
  const cite = {
    lane: "L1",
    why: "the Human chose half up",
    human: [{ line: "totals round half up", question: "H1" }],
  };
  assert.match((await h.call(sup, "supervisor", "amend_lane", cite)).text, /H1 is no question the Human answered/);
  await h.call(lead, "lead", "report", { summary: "done", ready: true });
  h.timelineOf(sup).add({ type: "user_message", text: "Half up.", clientMessageId: "app-2" });
  await h.call(sup, "supervisor", "record_human_answer", { question: "H1", choice: "Half up", quote: "half up" });
  assert.match(
    (await h.call(sup, "supervisor", "amend_lane", cite)).text,
    /^Lane L1 is amended and its Lead has the change\.$/,
  );
  assert.ok(h.ledger().lanes.L1!.ready, "naming whose word stands behind a line changes nothing it is asked");
  assert.match(
    h.heard(lead).join("\n"),
    /The Human's own ask, on their word:\n- totals round half up \(the Human's, H1\)/,
  );

  await h.call(lead, "lead", "report", { summary: "done again", ready: true });
  await h.idle(sup);
  assert.match(
    h.heard(sup).join("\n"),
    new RegExp(
      `REPORT L1 \\(Tax\\): ready to land[^]*What the desk read of it:[^]*The Human asked for "tax shows on the receipt" \\(the Human's, "the tax must show on the receipt"\\), and ${sup} changed it without their word\\.`,
    ),
  );
});
