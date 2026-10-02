import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
const traced = {
  severity: "P1",
  where: "a.txt:1",
  failure: "rounds down",
  fix: "round up",
  confirmedBy: "a.txt:1 floors",
};
const edge = { severity: "P2", where: "a.txt:2", failure: "negative totals round away", fix: "clamp" };
const minor = { severity: "P3", failure: "the name says cents", fix: "rename" };

test("a review blocks only on a P0 or P1 it shows how it confirmed, keeps P2 and P3 as the lane's backlog, and stops its rounds at the second", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Rounding", outcome: "money rounds correctly", ...scope });
  const lane = h.ledger().lanes.L1!;
  const lead = lane.lead!;
  await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "t", title: "Round", goal: "g", ...scope }] });
  h.commit(lane.worktree!, "a.txt", "rounded\n");
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "rounded" });
  await h.idle(peer);
  const review = async (on: Record<string, unknown>) => {
    assert.equal((await h.call(lead, "lead", "start_review", { focus: "Is it right?", ...on })).ok, true);
    const started = Object.values(h.ledger().tasks)
      .filter((task) => task.kind === "review")
      .at(-1)!;
    const done = async (verdict: string, findings: object[]) => {
      const reply = await h.call(started.peer!, "reviewer", "done", { verdict, answer: "Read the diff.", findings });
      await h.idle(started.peer!);
      return reply;
    };
    return { id: started.id, done, brief: () => h.agents.get(started.peer!)!.prompt ?? "" };
  };
  const next = () => /\nNext: (.*)$/.exec(h.heard(lead).at(-1)!)![1]!;

  const first = await review({ task: "L1-T1" });
  const { confirmedBy: _, ...untraced } = traced;
  assert.match(
    (await first.done("changes", [untraced, edge])).text,
    /^A P0 or P1 finding sends work back, so it says in confirmedBy how it was reproduced[^]*Give that for P1 a\.txt:1, or rate it P2/,
  );
  assert.match(
    (await first.done("changes", [edge])).text,
    /^A changes verdict sends work back, so it rests on a P0 or P1 finding\. With none, the verdict is accept/,
  );
  assert.equal(h.ledger().tasks[first.id]!.handback, undefined);
  assert.equal((await first.done("accept", [edge, minor])).ok, true);
  assert.deepEqual(h.ledger().tasks[first.id]!.handback?.findings, [edge, minor]);

  const question = await review({});
  assert.equal((await question.done("changes", [])).ok, true, "a question is answered as its reviewer sees fit");
  const second = await review({ task: "L1-T1" });
  assert.equal((await second.done("changes", [traced])).ok, true);
  assert.match(next(), /^Weigh its findings, then cut it/);
  const third = await review({ task: "L1-T1" });
  assert.equal((await third.done("changes", [traced])).ok, true);
  assert.match(next(), /^Reviews of L1-T1 ended in changes 2 times: stop the rounds\./);

  assert.equal((await h.call(lead, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  const backlog = `L1-R1 P2 a\\.txt:2: negative totals round away; L1-R1 P3 the name says cents`;
  assert.match(
    (await h.call(lead, "lead", "report", { summary: "done", ready: true })).text,
    new RegExp(`Backlog from its reviews, 2 P2/P3 findings: ${backlog}\\.`),
  );
  const whole = await review({ scope: "lane" });
  assert.match(
    whole.brief(),
    /Already in the lane's backlog from its reviews, so not to report again:\n- L1-R1 P2 a\.txt:2: negative totals round away\n- L1-R1 P3 the name says cents\n/,
  );
});
