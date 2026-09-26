import assert from "node:assert/strict";
import { test } from "node:test";
import { type Pending } from "./fake-paseo.ts";
import { harness } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

const SUPERVISOR = "sw2-supervisor-claude/claude-opus-5";
const heard = (h: Harness, id: string) => h.heard(id).join("\n");
const task = (title: string) => ({
  key: "t",
  title,
  goal: "g",
  acceptance: ["a"],
  hints: ["a.txt"],
  outOfScope: ["the rest"],
});

test("a seat's trouble reaches whoever owns it, named as Paseo shows it, and what only the Human can give waits for them", async () => {
  const h = harness();
  const architecture = h.add(SUPERVISOR, h.root, "architecture");
  const safety = h.add(SUPERVISOR, h.root, "safety");
  const scope = { acceptance: ["a"], outOfScope: ["anything else"] };
  await h.call(architecture, "supervisor", "open_lane", { title: "Build", outcome: "a.txt changes", ...scope });
  await h.call(safety, "supervisor", "open_lane", {
    title: "Permissions",
    outcome: "writes are checked",
    ...scope,
    isolate: true,
  });
  const { L1: build, L2: permissions } = h.ledger().lanes;
  assert.deepEqual([build!.opener, permissions!.opener], [architecture, safety]);
  const lead = build!.lead!;
  await h.call(lead, "lead", "add_tasks", { tasks: [task("Clean build")] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  // A Watcher has no ask: told to use one, it was pointed at a tool it cannot call.
  const watcher = h.add("sw2-watcher-claude/claude-opus-5", h.root, "watcher");
  let turns = 0;
  const fail = (id: string, title: string | null = h.agents.get(id)!.title) => {
    const seat = h.agents.get(id)!;
    return h.runtime.turnEnded({
      agent: { id, provider: seat.provider, cwd: seat.cwd, title },
      turnId: `t-${++turns}`,
      outcome: { kind: "failed", error: { message: "the model is overloaded" } },
      timeline: [],
    });
  };

  await h.call(lead, "lead", "report", { summary: "schema done", ready: false });
  await h.call(permissions!.lead!, "lead", "report", { summary: "permissions done", ready: false });
  assert.match(heard(h, architecture), /schema done/);
  assert.doesNotMatch(heard(h, architecture), /permissions done/, "one supervising seat does not read another's lane");
  assert.match(heard(h, safety), /permissions done/);

  const question: Pending = {
    id: "permission-1",
    kind: "question",
    name: "AskUserQuestion",
    title: "Which colour should the button be?",
    input: { questions: [{ question: "Which colour should the button be?", options: [{ label: "Blue" }] }] },
  };
  for (const [seat, instead] of [
    [peer, /ask it with ask, then end your turn/],
    [architecture, /put it to the Human with ask_human, or ask them in your reply and end your turn/],
    [
      watcher,
      /^A question that stops your turn is not taken here: answer from what you have, saying what you could not settle, then end your turn\.$/,
    ],
  ] as const) {
    h.agents.get(seat)!.pending.push(question);
    await h.permission(seat, question);
    const answer = h.agents.get(seat)!.answered.at(-1)!.response as { behavior: string; message?: string };
    assert.equal(answer.behavior, "deny");
    assert.match(String(answer.message), instead);
  }
  assert.doesNotMatch(heard(h, lead), /WAITING FOR PERMISSION/, "nobody is asked to answer what was put another way");

  // Leave to run something is the Human's to give; the desk answers nothing on anyone's behalf.
  const command: Pending = { id: "permission-2", kind: "tool", name: "Bash", title: "rm -rf build" };
  h.agents.get(peer)!.pending.push(command);
  await h.permission(peer, command);
  assert.match(
    heard(h, lead),
    /WAITING FOR PERMISSION: L1-T1 · Peer · Clean build has stopped until this is answered\.\n\nBash: rm -rf build\n\nOnly the Human can answer this[^]*\n\nNext: If it holds the lane up, ask, so the owner can tell the Human\./,
  );
  const held = await h.call(lead, "lead", "message", { to: "L1-T1", text: "Go ahead." });
  assert.match(held.text, /stopped on a permission only the Human can give/);
  assert.equal(h.agents.get(peer)!.answered.length, 1, "the command is left for the Human");
  assert.equal(h.runtime.outbox.pending(peer).length, 1, "and the message waits for it");

  await fail(peer);
  assert.match(
    heard(h, lead),
    /FAILED: L1-T1 · Peer · Clean build ended its turn with an error: the model is overloaded\n\nNext: Nothing restarts it: message it to continue, or cut the task and start it again\./,
  );
  await fail(lead);
  assert.match(
    heard(h, architecture),
    /FAILED: L1 · Lead · Build ended its turn with an error: the model is overloaded\n\nNext: Nothing restarts it: read what it did, then message the lane to continue, or drop_lane it and open it again\./,
  );
  await fail(lead, null);
  assert.match(heard(h, architecture), new RegExp(`FAILED: Lead ${lead} ended its turn`), "untitled, by role and id");

  await h.idle(lead);
  Object.assign(h.agents.get(lead)!, { archivedAt: new Date().toISOString(), status: "closed" });
  await fail(peer);
  const second: Pending = { id: "permission-3", kind: "tool", name: "Bash", title: "rm -rf build" };
  h.agents.get(peer)!.pending.push(second);
  await h.permission(peer, second);
  assert.match(
    heard(h, architecture),
    /FAILED: L1-T1 · Peer · Clean build ended its turn with an error: the model is overloaded\n\nNext: Its Lead is gone: replace_lead puts a new Lead on the lane, which can message it to continue or cut its task\./,
  );
  assert.match(
    heard(h, architecture),
    /WAITING FOR PERMISSION: [^]*Bash: rm -rf build[^]*\n\nNext: Tell the Human it waits on them\./,
  );
  assert.deepEqual(h.runtime.outbox.pending(lead), [], "nothing is left for a Lead that is gone");
  h.commit(build!.worktree!, "a.txt", "done\n");
  assert.equal((await h.call(peer, "peer", "done", { outcome: "complete", summary: "a.txt changed" })).ok, true);
  assert.match(
    heard(h, architecture),
    /HANDBACK L1-T1 \(Clean build\) from [^]*Next: Its Lead is gone: replace_lead puts a new Lead on the lane, this hand-back included/,
  );
});

test("reaching a Peer directly tells its Lead what reached it, and is refused when there is no Lead to tell", async () => {
  const h = harness();
  const sup = h.add(SUPERVISOR, h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", {
    title: "Pricing",
    outcome: "discounts round correctly",
    acceptance: ["a"],
    outOfScope: ["anything else"],
  });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [task("Round")] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  const reach = (text: string) => h.call(sup, "supervisor", "message", { to: "L1-T1", text });

  const reached = await reach("Use banker's rounding, not half-up.");
  assert.equal(reached.ok, true, reached.text);
  await h.idle(peer);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(peer)!.sent.join("\n"), /banker's rounding/);
  // The Lead is not merely copied: it is given back the five things it needs to hold the room's state.
  const toLead = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(toLead, /RECONCILE L1/);
  assert.match(toLead, /banker's rounding/, "what reached the Peer");
  assert.match(toLead, /Current intent: discounts round correctly/);
  assert.match(toLead, /Ownership: L1-T1 .* is still owned by/);
  assert.match(toLead, /Topology: unchanged/);
  assert.match(toLead, /Integration and acceptance: unchanged/);

  // The same instruction again is a second instruction, not a repeat to drop by its words.
  await h.idle(peer);
  await h.idle(lane.lead!);
  assert.equal((await reach("Use banker's rounding, not half-up.")).ok, true);
  await h.idle(peer);
  await h.idle(lane.lead!);
  assert.equal(h.agents.get(peer)!.sent.join("\n").split("banker's rounding").length - 1, 2, "both reached the Peer");
  assert.equal(h.agents.get(lane.lead!)!.sent.join("\n").split("RECONCILE L1").length - 1, 2, "the Lead is told both");

  // With no Lead to reconcile to, the intervention is refused rather than run behind its back.
  Object.assign(h.agents.get(lane.lead!)!, { archivedAt: new Date().toISOString(), status: "closed" });
  const orphaned = await reach("One more thing.");
  assert.equal(orphaned.ok, false);
  assert.match(orphaned.text, /no running Lead/);
  // A task already cut has no Peer left to steer.
  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" });
  const cut = await reach("One more thing.");
  assert.equal(cut.ok, false);
  assert.match(cut.text, /L1-T1 is cut/);
});
