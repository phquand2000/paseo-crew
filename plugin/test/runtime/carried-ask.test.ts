import assert from "node:assert/strict";
import { test } from "node:test";
import { contracts } from "../../shared/rpc.ts";
import { harness, laneWithPeer } from "./harness.ts";

const SUPERVISOR = "crew-supervisor-claude/claude-opus-5";

test("a Peer parked on an ask its Lead carries up waits unnudged and unreminded until the answer comes down", async () => {
  const h = harness();
  const sup = h.add(SUPERVISOR, h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", {
    title: "Parked",
    outcome: "x",
    acceptance: ["a"],
    outOfScope: ["anything else in the repository"],
  });
  const lead = h.ledger().lanes.L1!.lead!;
  const work = { key: "t", title: "Work", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] };
  await h.call(lead, "lead", "add_tasks", { tasks: [work] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  const heard = (id: string) => h.heard(id).join("\n");
  const turn = async (said: string) => {
    h.runtime.outbox.turnEnded(peer);
    await new Promise((resolve) => setTimeout(resolve, 3));
    await h.beginTurn(peer);
    await h.endTurn(peer, said);
  };
  h.agents.get(peer)!.status = "idle";

  const asked = await h.call(peer, "peer", "ask", {
    question: "May I restart the service?",
    tried: "it is the Human's",
    bestGuess: "wait with a clean tree",
  });
  assert.equal(asked.ok, true, asked.text);
  const up = await h.call(lead, "lead", "ask", {
    kind: "need",
    text: "The Human's ruling on the service.",
    default: "the Peer waits",
    carries: ["a1"],
  });
  assert.match(up.text, /Asked as A2, carrying A1\. Leave A1 open/);
  assert.equal(h.ledger().asks.A1!.status, "open");
  assert.match(heard(sup), /ASK A2 \(need\)[\s\S]*Carries A1: the Peer on L1-T1 waits on this answer\./);
  assert.match(heard(peer), /CARRIED UP A1: your Lead put it to the owner as A2\./);

  await turn("Parked: waiting on A1.");
  await turn("Still parked.");
  const task = () => h.ledger().tasks["L1-T1"]!;
  assert.deepEqual([task().status, task().silent], ["running", 0], "a Peer waiting on its open ask is not silent");
  assert.doesNotMatch(heard(peer), /without calling done or ask/);
  assert.doesNotMatch(heard(lead), /SILENT L1-T1/);
  assert.doesNotMatch(heard(sup), /STRUGGLING L1-T1/);

  await h.idle(lead);
  await h.idle(sup);
  await h.tick(Date.now() + 16 * 60_000);
  assert.match(heard(sup), /STILL OPEN after \d+ minutes: ask A2/, "the ask carrying it is reminded");
  assert.doesNotMatch(heard(lead), /ask A1/, "the carried one is not");

  const ruled = await h.call(sup, "supervisor", "answer", {
    ask: "A2",
    text: "Wait for tomorrow.",
    keepsDefault: true,
  });
  assert.equal(ruled.ok, true, ruled.text);
  assert.match(heard(lead), /ANSWER to your ask A2[\s\S]*It carries A1: answer A1 for its Peer from it/);
  const again = await h.call(lead, "lead", "ask", { kind: "need", text: "x", default: "y", carries: ["A2"] });
  assert.match(again.text, /A2 is not a Peer's open ask put to you on L1\./);
  assert.equal(Object.keys(h.ledger().asks).length, 2);
  await h.call(lead, "lead", "answer", { ask: "A1", text: "Wait for tomorrow.", keepsDefault: true });

  await turn("Answered; still nothing to do.");
  assert.equal(task().silent, 1, "answered, its quiet turns count again");
  assert.match(heard(peer), /without calling done or ask/);
});

test("a Lead's ask carried into a Human question is not reminded while they are silent, and their answer names it", async () => {
  const { h, sup, lane } = await laneWithPeer();
  const heard = (id: string) => h.heard(id).join("\n");
  const human = (carries: string[]) =>
    h.call(sup, "supervisor", "ask_human", {
      question: "Restart the service tonight?",
      why: "Only they may take the downtime.",
      options: [
        { label: "Tonight", effect: "Ten minutes offline." },
        { label: "Tomorrow", effect: "The fix waits a day." },
      ],
      recommend: "Tomorrow",
      reason: "Nobody is on call tonight.",
      ifSilent: "The lane waits with a clean tree.",
      class: "reversible",
      carries,
    });
  await h.call(lane.lead!, "lead", "ask", { kind: "need", text: "May the service restart?", default: "wait" });
  assert.match((await human(["A9"])).text, /A9 is not an open ask put to you\./);
  assert.match((await human(["a1"])).text, /Asked the Human as H1;[\s\S]* It carries A1: leave them open/);
  assert.deepEqual(Object.keys(h.ledger().questions), ["H1"]);

  await h.idle(sup);
  await h.tick(Date.now() + 16 * 60_000);
  assert.doesNotMatch(
    heard(sup),
    /STILL OPEN after \d+ minutes: ask A1/,
    "carried into an open question, it waits unreminded",
  );

  const answered = await h.rpc(contracts.questionAnswer, {
    project: h.project.slug,
    question: "H1",
    choice: "Tomorrow",
    note: "",
  });
  assert.deepEqual(answered, { answered: "H1 is answered: Tomorrow. The Supervisor has it." });
  assert.match(heard(sup), /HUMAN ANSWERED H1[\s\S]*answer A1, which it carries/);
  await h.idle(sup);
  await h.tick(Date.now() + 32 * 60_000);
  assert.match(heard(sup), /STILL OPEN after \d+ minutes: ask A1/, "answered, the question no longer stands for it");
});
