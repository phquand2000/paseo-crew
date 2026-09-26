import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { sentBy } from "../../server/core/sent-by.ts";
import { contracts } from "../../shared/rpc.ts";
import { tempDir } from "../tempdir.ts";
import { harness } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

const SUPERVISOR = "sw2-supervisor-claude/claude-opus-5";
const task = (title: string, hint = "a.txt") => ({
  key: "t",
  title,
  goal: "g",
  acceptance: ["a"],
  hints: [hint],
  outOfScope: ["the rest of the repository"],
});
const heard = (h: Harness, id: string) => h.heard(id).join("\n");
const archive = (h: Harness, id: string) =>
  Object.assign(h.agents.get(id)!, { archivedAt: new Date().toISOString(), status: "closed" });

/** A lane opened by a supervising seat, with its Lead and, given a title, one task and its Peer. */
async function lane(h: Harness, sup: string, title: string, work?: string) {
  await h.call(sup, "supervisor", "open_lane", {
    title,
    outcome: "x",
    acceptance: ["a"],
    outOfScope: ["anything else in the repository"],
  });
  const opened = h.ledger().lanes.L1!;
  if (work) await h.call(opened.lead!, "lead", "add_tasks", { tasks: [task(work)] });
  return { lane: opened, lead: opened.lead!, peer: work ? h.ledger().tasks["L1-T1"]!.peer! : "" };
}

/** Whether `check` comes true within `ms`, looked at every 20 ms. */
async function within(ms: number, check: () => boolean): Promise<boolean> {
  for (const end = Date.now() + ms; !check(); await new Promise((resolve) => setTimeout(resolve, 20)))
    if (Date.now() > end) return false;
  return true;
}

test("an ask reaches whoever can answer it, the answer comes back once, and whoever it was put to is told of it", async () => {
  const h = harness();
  const sup = h.add(SUPERVISOR, h.root, "sup");
  const { lead } = await lane(h, sup, "Asks");
  await h.idle(lead);
  const asked = await h.call(lead, "lead", "ask", {
    kind: "question",
    text: "Round half up or down?",
    default: "half up",
  });
  assert.equal(asked.ok, true, asked.text);
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.at(-1)!, /ASK A1 \(question\)[\s\S]*half up/);
  assert.equal((await h.call(sup, "supervisor", "answer", { ask: "A1", text: "Half up." })).ok, true);
  await h.idle(lead);
  assert.match(h.agents.get(lead)!.sent.join("\n"), /ANSWER to your ask A1[\s\S]*Half up/);
  // Its first prompt too carries the kinds of its letters in its id, so the watch tells desk mail from a person's words.
  assert.deepEqual(sentBy({ clientMessageId: h.agents.get(lead)!.promptId }), ["brief"]);
  assert.deepEqual(sentBy({ clientMessageId: h.agents.get(lead)!.sentIds.at(-1) }), ["answer"]);
  const again = await h.call(sup, "supervisor", "answer", { ask: "A1", text: "Half down." });
  assert.deepEqual([again.ok, again.text], [false, "Ask A1 is already answered."]);

  await h.call(lead, "lead", "add_tasks", { tasks: [task("Drop it")] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  const columns = await h.call(peer, "peer", "ask", {
    question: "Drop the column or keep it nullable?",
    tried: "read the migration",
    bestGuess: "keep it nullable",
  });
  assert.equal(columns.ok, true, columns.text);
  const ask = Object.values(h.ledger().asks).at(-1)!;
  assert.equal(ask.to, lead, "an ask goes upward, to the Lead");
  // Unanswered asks escalate to the owner, so the owner answering one is the design.
  assert.equal((await h.call(sup, "supervisor", "answer", { ask: ask.id, text: "Drop it and migrate." })).ok, true);
  assert.match(heard(h, peer), /Drop it and migrate/, "the Peer gets its answer");
  assert.match(heard(h, lead), new RegExp(`ANSWERED FOR YOU: ${ask.id}`), "the Lead holds the room's state");
  assert.match(heard(h, lead), /Drop it and migrate[^]*accepting it is still yours to judge/);

  const rounding = await h.call(peer, "peer", "ask", {
    question: "Round half up or down?",
    tried: "read the spec",
    bestGuess: "half up",
  });
  assert.equal(rounding.ok, true, rounding.text);
  const escalating = Object.values(h.ledger().asks).at(-1)!.id;
  h.agents.get(lead)!.status = "idle";
  archive(h, sup);
  const start = Date.now();
  for (const minutes of [16, 32, 48]) await h.tick(start + minutes * 60_000);
  assert.equal(h.ledger().asks[escalating]!.escalated ?? false, false, "nobody received it, so it is not escalated");
  const back = h.add(SUPERVISOR, h.root, "sup-2");
  await h.tick(start + 64 * 60_000);
  assert.equal(h.ledger().asks[escalating]!.escalated, true);
  assert.match(
    heard(h, back),
    /Round half up or down\?\n\nTried: read the spec\n\nTheir default: half up/,
    "the one who sat down is told, the Peer's best guess with it",
  );

  assert.equal(
    (await h.call(lead, "lead", "ask", { kind: "question", text: "Keep the old endpoint?", default: "keep it" })).ok,
    true,
  );
  const endpoint = Object.values(h.ledger().asks).at(-1)!.id;
  archive(h, back);
  const next = h.add(SUPERVISOR, h.root, "sup-3");
  await h.tick(start + 80 * 60_000);
  assert.match(
    heard(h, next),
    /Keep the old endpoint\?/,
    "an ask to a reader since gone goes to whoever supervises now",
  );
  assert.equal(h.ledger().asks[endpoint]!.to, next);
});

test("a Peer's silence is counted turn by turn, nudged, then told to its Lead, and a word from it undoes the stall", async () => {
  const h = harness();
  const sup = h.add(SUPERVISOR, h.root, "sup");
  const { lead, peer } = await lane(h, sup, "Quiet", "Work");
  const silent = () => h.ledger().tasks["L1-T1"]!.silent;
  /** One turn of the Peer's, ending with what it said; real turns are seconds apart, so the desk's turn clock moves first. */
  const turn = async (said: string, during?: () => Promise<unknown>) => {
    h.runtime.outbox.turnEnded(peer);
    await new Promise((resolve) => setTimeout(resolve, 3));
    await h.beginTurn(peer);
    await during?.();
    await h.endTurn(peer, said);
  };
  const ask = () =>
    h.call(peer, "peer", "ask", {
      question: "Which file first?",
      tried: "read both",
      bestGuess: "the one the test names",
    });
  h.agents.get(peer)!.status = "idle";

  await turn("still reading");
  assert.equal(silent(), 1);
  assert.match(h.agents.get(peer)!.sent.at(-1)!, /without calling done or ask/);
  assert.match(h.agents.get(peer)!.sent.at(-1)!, /`done` and `ask` are tools of the `team` MCP server/);
  await turn("asked and waiting", ask);
  assert.equal(silent(), 0, "the count is of turns in a row, not a lifetime tally");
  await turn("applying it");
  assert.deepEqual([h.ledger().tasks["L1-T1"]!.status, silent()], ["running", 1], "it asked in between");
  await turn("Still looking.");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  assert.match(
    heard(h, lead),
    /SILENT L1-T1[\s\S]*Still looking[\s\S]*Next: If its last words hand the work back without calling done, message it to call done; else message it, or cut it and start again\./,
    "accept needs a hand-back on record, so it is not offered",
  );

  // Its Peer is still seated in the lane's copy, so a stalled task still holds it.
  const more = await h.call(lead, "lead", "add_tasks", { tasks: [task("More", "b.txt")] });
  assert.match(more.text, /L1-T2 More: held: L1-T1 is still writing/);
  assert.equal(h.ledger().tasks["L1-T2"]!.peer, undefined);
  await turn("asked", ask);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "heard from, it runs again");

  // The same instruction twice: letters are keyed by the event, so the second really goes.
  for (let sent = 0; sent < 2; sent++) {
    const rework = await h.call(lead, "lead", "rework", { task: "L1-T1", text: "Commit your work." });
    assert.equal(rework.ok, true, rework.text);
  }
  h.runtime.outbox.turnEnded(peer);
  await h.runtime.outbox.pump(peer);
  assert.equal(
    h.agents
      .get(peer)!
      .sent.join("\n")
      .match(/Commit your work/g)?.length,
    2,
    "both went",
  );
});

test("a Peer that is gone is found past the first page of agents, its Lead told, its copy freed, and its mail shown until given up on", async () => {
  const h = harness();
  const sup = h.add(SUPERVISOR, h.root, "sup");
  // A long-lived daemon: plenty of other agents, more recently active than the Peer about to start.
  for (let index = 0; index < 205; index++) h.add(SUPERVISOR, h.root, `other-${index}`);
  const { lead, peer } = await lane(h, sup, "Gone", "Work");
  assert.ok(h.agents.size > 200, "the seats this lane needs are past the first page");
  await h.tick(Date.now());
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "a seat not on the first page is not a seat that is gone");
  assert.doesNotMatch(heard(h, lead), /was closed or archived/);

  const queued = await h.call(lead, "lead", "message", { to: "L1-T1", text: "Stop: the premise is wrong." });
  assert.match(queued.text, /Queued for the Peer on L1-T1/);
  archive(h, peer);
  await h.tick(Date.now());
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  assert.match(
    heard(h, lead),
    /its agent was closed or archived[\s\S]*Next: Nothing restarts it, and without a hand-back it cannot be accepted: cut it and start it again, naming its branch in the new brief if what it committed is worth carrying on\./,
  );
  const stranded = new RegExp(
    `## Mail with nobody to read it\n\nThe seat each of these was addressed to is gone, and no other seat is sent them: pass on what still matters before each is given up on\\.\n\n- to ${peer}, waiting 0 min, given up on in 7 days: MESSAGE from your lead`,
  );
  assert.match(readFileSync(join(h.project.state, "status.md"), "utf-8"), stranded, "in the page the round writes");
  assert.match((await h.rpc(contracts.status, { project: h.project.slug })).text, stranded, "and on the panel");

  const more = await h.call(lead, "lead", "add_tasks", { tasks: [task("More", "b.txt")] });
  assert.match(
    more.text,
    /- T is L1-T2 More: running, Peer/,
    "nobody writes in the copy any more, so nothing waits for it",
  );
});

test("a call that runs longer than a seat can wait is answered once by mail, and the turn it ends is not silence", async (t) => {
  const go = join(tempDir("sw2-slow-"), "go");
  t.after(() => writeFileSync(go, ""));
  const h = harness();
  const sup = h.add(SUPERVISOR, h.root, "sup");
  // The gate waits for the test, so each call is still being worked on for as long as the test needs.
  const gate = `until [ -f ${go} ]; do sleep 0.05; done`;
  await h.call(sup, "supervisor", "set_project", { gate });
  const { lead, lane: opened } = await lane(h, sup, "Slow");
  const call = (id: string, agent: string, role: string, tool: string, args: Record<string, unknown>) =>
    h.runtime.desk.answer({ id, agent, role, tool, args, cwd: h.root, at: Date.now() }, { within: 100 });

  // The bridge waits five minutes but the gate thirty, so a retried call must not start a second gate.
  const report = { summary: "ready to land", ready: true };
  const [first, again] = await Promise.all([
    call("r1", lead, "lead", "report", report),
    call("r2", lead, "lead", "report", report),
  ]);
  assert.match(first.text, /still working on report/);
  assert.match(again.text, /already running/);
  writeFileSync(go, "");
  assert.ok(await within(5000, () => /ANSWER to your report call/.test(heard(h, lead))), "answered as mail");
  assert.equal(readdirSync(join(h.project.state, "gates")).filter((name) => name.startsWith("L1-")).length, 1);
  assert.equal(heard(h, lead).split("ANSWER to your report call").length - 1, 1, "once, for both calls");
  assert.match(heard(h, sup), /REPORT L1/);

  rmSync(go);
  await h.call(sup, "supervisor", "set_project", { gateOn: "task" });
  await h.call(lead, "lead", "add_tasks", { tasks: [task("Work")] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.commit(opened.worktree!, "a.txt", "A\n");
  await h.beginTurn(peer);
  assert.match(
    (await call("d1", peer, "peer", "done", { outcome: "complete", summary: "done" })).text,
    /still working on done/,
  );
  h.agents.get(peer)!.status = "idle";
  await h.endTurn(peer, "handed back, ending my turn as told");
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 0, "a call still being worked on is not silence");
  assert.doesNotMatch(heard(h, peer), /without calling done or ask/);
  writeFileSync(go, "");
  assert.ok(await within(5000, () => h.ledger().tasks["L1-T1"]!.status === "done"));
  assert.match(heard(h, lead), new RegExp(`Gate: ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} passed`));
});

test("mail reaches a running seat inside its turn where its harness can take it there, and waits where it cannot", async (t) => {
  const h = harness();
  // omp takes mail only between turns.
  writeFileSync(
    join(h.project.state, "settings.json"),
    JSON.stringify({ roles: { peer: { harness: "omp", model: "glm-5" } } }),
  );
  const sup = h.add(SUPERVISOR, h.root, "sup");
  const { lead, peer } = await lane(h, sup, "Pricing", "Round");
  assert.deepEqual([h.agents.get(lead)!.status, h.agents.get(peer)!.status], ["running", "running"]);

  // Paseo turns a steer the provider cannot take yet into replacing the turn, so a new turn is left alone.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  await h.beginTurn(lead);
  await h.beginTurn(peer);
  const early = await h.call(sup, "supervisor", "message", { to: "L1", text: "Is the premise right?" });
  assert.match(early.text, /Queued for the Lead of L1/);
  t.mock.timers.tick(2 * 60_000);
  await h.tick();
  assert.match(h.agents.get(lead)!.steered.join("\n"), /Is the premise right\?/, "delivered once the turn has settled");

  const toLead = await h.call(sup, "supervisor", "message", { to: "L1", text: "Stop: the premise is wrong." });
  assert.match(toLead.text, /Delivered to the Lead of L1/);
  assert.match(h.agents.get(lead)!.steered.join("\n"), /the premise is wrong/, "the Lead's harness takes it mid-turn");
  const toPeer = await h.call(lead, "lead", "message", { to: "L1-T1", text: "Stop: the premise is wrong." });
  assert.match(toPeer.text, /Queued for the Peer on L1-T1/);
  assert.deepEqual(h.agents.get(peer)!.sent, [], "the Peer's harness cannot, and sending would replace its turn");
});
