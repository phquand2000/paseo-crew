import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
const finding = { severity: "P1", where: "a.txt:1", failure: "rounds half down", fix: "round half up" };

test("what each review and ask went on to change is counted for whoever supervises", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Rounding", outcome: "money rounds correctly", ...scope });
  const lane = h.ledger().lanes.L1!;
  const lead = lane.lead!;
  await h.call(lead, "lead", "add_tasks", {
    tasks: [{ key: "t", title: "Round", goal: "g", ...scope, hints: ["a.txt"] }],
  });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  await h.call(peer, "peer", "ask", { question: "Which rounding?", tried: "the spec", bestGuess: "half down" });
  assert.equal(
    (await h.call(lead, "lead", "answer", { ask: "A1", text: "Half up." })).text,
    "A1 came with a default (half down): say with keepsDefault whether your answer keeps it.",
  );
  assert.equal((await h.call(lead, "lead", "answer", { ask: "A1", text: "Half up.", keepsDefault: false })).ok, true);

  const handBack = async (content: string) => {
    h.commit(lane.worktree!, "a.txt", content);
    await h.call(peer, "peer", "done", { outcome: "complete", summary: content });
  };
  const review = async (verdict: string, task?: string) => {
    await h.call(lead, "lead", "start_review", { focus: "Is the rounding right?", ...(task ? { task } : {}) });
    const reviewer = Object.values(h.ledger().tasks).at(-1)!.peer!;
    const findings = verdict === "accept" ? [] : [finding];
    await h.call(reviewer, "reviewer", "done", { verdict, answer: verdict, findings });
  };
  await handBack("down\n");
  await review("changes", "L1-T1");
  assert.equal((await h.call(lead, "lead", "rework", { task: "L1-T1", text: "Round half up." })).ok, true);
  await handBack("up\n");
  await review("accept", "L1-T1");
  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  await review("accept");

  assert.equal(
    (await h.call(sup, "supervisor", "outcomes", {})).text,
    [
      "Outcomes over the whole log kept. Events written before these counts were kept are left out.",
      "",
      "Reviews by the reviewer's role, and what came next for the task reviewed:",
      "- reviewer: 3 (accept 2, changes 1); then reworked 1, accepted 1, on no task 1",
      "",
      "Asks by who asked and its kind, and whether the answer kept the asker's default:",
      "- peer question: 1 (changed 1); median wait 0 min",
      "",
      "Accepted tasks: 1 (after one rework 1).",
    ].join("\n"),
  );
});
