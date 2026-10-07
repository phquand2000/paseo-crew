import assert from "node:assert/strict";
import { test } from "node:test";
import { askLetters } from "../../server/desk/letters/ask-letters.ts";
import { type Letter } from "../../server/desk/letters/envelope.ts";
import { keptLetters } from "../../server/desk/letters/kept-letters.ts";
import { landLetters } from "../../server/desk/letters/land-letters.ts";
import { messageLetters } from "../../server/desk/letters/message-letters.ts";
import { workLetters } from "../../server/desk/letters/work-letters.ts";
import type { Ask } from "../../server/domain/ask.ts";
import type { Question } from "../../server/domain/question.ts";
import { lane, task } from "./letter-fixtures.ts";

test("someone's words reach their reader as a person writes them: no desk heading, no Next line, and what was said word for word", () => {
  const sending = { by: "agent-1", to: "L1", at: 0 };
  const ask: Ask = {
    id: "A2",
    from: "agent-3",
    fromRole: "peer",
    to: "agent-2",
    lane: "L1",
    task: task.id,
    kind: "question",
    text: "Which rounding?",
    default: "half up",
    status: "answered",
    answer: "half even",
    openedAt: 0,
  };
  const amendment = { at: 0, by: "agent-1", why: "the Human wants an upsert", was: { goal: "insert" } };
  const question: Question = {
    id: "H1",
    from: "sup",
    question: "Delete or archive?",
    why: "w",
    options: [],
    recommend: "Archive",
    reason: "r",
    ifSilent: "s",
    class: "reversible",
    status: "answered",
    openedAt: 0,
    answer: { choice: "Delete", by: "panel", at: 0 },
  };
  assert.equal(messageLetters.message("Hold off on the migration.", sending).text, "Hold off on the migration.");
  assert.equal(workLetters.rework(task, "Round half even.").text, "Round half even.");
  const spoken: [string, Letter][] = [
    ["reconcile", messageLetters.reconciled(lane, task, "agent-9", "stop using the old client", sending)],
    ["answered for", askLetters.answeredFor(ask, "the owner")],
    ["answer", askLetters.answered(ask)],
    ["answer to a Lead", askLetters.answered({ ...ask, fromRole: "lead" }, ["A3"], true)],
    ["ask", askLetters.askTo({ ...ask, status: "open" }, "the engineer on L1-T1", "lead")],
    ["carried", askLetters.carried(ask, "A5")],
    ["overruled", askLetters.overruled(ask)],
    ["human answered", askLetters.humanAnswered(question, undefined)],
    ["amended lane", workLetters.amended(lane, amendment, "lead")],
    ["amended task", workLetters.amended(task, amendment, "worker")],
    ["hold", workLetters.onHold(lane, "the migration drops a table")],
    ["hold a task", workLetters.onHold(lane, "the migration drops a table", task)],
    ["resumed", workLetters.resumed(lane, "go on")],
    ["handback", workLetters.handback(task, "Outcome: complete", "agent-3", "lead")],
    ["report", workLetters.report(lane, "done", true, [], { asks: [], facts: [] })],
    ["taken", workLetters.taken(lane, { ...amendment, was: { writeSet: [] } }, "")],
    ["released", keptLetters.released(task, "agent-3")],
    ["human wrote", messageLetters.humanWrote(lane, task, "agent-3", "use banker's rounding")],
    ["sent back", landLetters.landSentBack(lane, "put it behind a flag", "abc")],
    ["sent back, told", landLetters.landDecided(lane, "sent back", "put it behind a flag")],
  ];
  for (const [what, letter] of spoken) {
    assert.doesNotMatch(letter.text, /^[A-Z]{2,}/, `${what} opens with a sentence, not a heading: ${letter.text}`);
    assert.doesNotMatch(letter.text, /^Next: /m, `${what} has no Next line: ${letter.text}`);
  }
  assert.match(spoken[0]![1].text, /^I've written to the engineer on L1-T1 directly:\n\n> stop using the old client/);
  assert.match(spoken[1]![1].text, /^I answered A2 for you/);
  assert.match(
    spoken[17]![1].text,
    /<human>\nuse banker's rounding\n<\/human>/,
    "the Human's words stay fenced as data",
  );
});
