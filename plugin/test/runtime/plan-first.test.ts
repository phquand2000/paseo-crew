import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { settle } from "./fake-timeline.ts";
import { harness } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

const task = (key: string, title: string, extra: Record<string, unknown>) => ({
  key,
  title,
  goal: "g",
  acceptance: ["a"],
  outOfScope: ["the rest"],
  ...extra,
});

function edit(h: Harness, id: string, file: string, call: string) {
  const peer = h.ledger().tasks[id]!.peer!;
  const timeline = h.timelineOf(peer);
  timeline.beat("turn_started", `${call}-turn`);
  const detail = {
    type: "edit",
    filePath: join(h.ledger().tasks[id]!.worktree!, file),
    oldString: "",
    newString: "x\n",
  };
  timeline.add({ type: "tool_call", callId: call, name: "Edit", status: "completed", detail }, `${call}-turn`);
}

const skipped = (h: Harness) =>
  h
    .events("watch.fact")
    .filter((event) => event.fact === "plan-skipped")
    .map((event) => event.agent);

test("a task whose Lead asks for the plan first tells the Lead when its Peer changes code before it asked, and only then", async () => {
  const h = harness();
  mkdirSync(h.project.state, { recursive: true });
  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ attention: { watch: true } }));
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", acceptance: ["a"], outOfScope: [] });
  const lead = h.ledger().lanes.L1!.lead!;
  await h.call(lead, "lead", "add_tasks", {
    tasks: [
      task("t", "Totals", { hints: ["cart.ts"], planFirst: true }),
      task("s", "Side", { holds: ["side.ts"], parallel: true }),
    ],
  });
  await h.tick();
  const [first, side] = ["L1-T1", "L1-T2"].map((id) => h.ledger().tasks[id]!.peer!);
  assert.match(
    h.agents.get(first!)!.prompt ?? "",
    /Your Lead asks for your plan before you build: once you have read the code, ask with the shape you plan/,
  );
  assert.doesNotMatch(h.agents.get(side!)!.prompt ?? "", /asks for your plan/);

  edit(h, "L1-T2", "side.ts", "s1");
  edit(h, "L1-T1", "cart.ts", "w1");
  await settle();
  assert.deepEqual(skipped(h), [first], "a task with no plan asked for is free to build");
  await h.idle(lead);
  assert.match(
    h.heard(lead).join("\n"),
    /INCIDENT I\d+ \(plan-skipped, attend\) on the engineer on L1-T1 \(Totals\)[^]*What was seen: changed [^\n]*cart\.ts before it asked with its plan/,
  );

  const asked = await h.call(first!, "peer", "ask", {
    question: "Totals in the cart or the receipt?",
    tried: "read both",
  });
  assert.equal(asked.ok, true, asked.text);
  edit(h, "L1-T1", "cart.ts", "w2");
  await settle();
  assert.deepEqual(skipped(h), [first], "once it asked, what it builds is its own");
});
