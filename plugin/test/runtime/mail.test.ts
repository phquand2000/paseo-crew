import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { intentsPath } from "../../server/core/paths.ts";
import { sentBy } from "../../server/core/sent-by.ts";
import { contracts } from "../../shared/rpc.ts";
import { reported } from "../console.ts";
import { tempDir } from "../tempdir.ts";
import { harness, laneWithPeer } from "./harness.ts";
import { book } from "./noticed.ts";

type Harness = ReturnType<typeof harness>;

const SUPERVISOR = "crew-supervisor-claude/claude-opus-5";
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
  assert.equal(
    (await h.call(sup, "supervisor", "answer", { ask: "A1", text: "Half up.", keepsDefault: true })).ok,
    true,
  );
  await h.idle(lead);
  assert.match(h.agents.get(lead)!.sent.join("\n"), /ANSWER to your ask A1[\s\S]*Half up/);
  // Its first prompt too carries the kinds of its letters in its id, so the watch tells desk mail from a person's words.
  assert.deepEqual(sentBy({ clientMessageId: h.agents.get(lead)!.promptId }), ["brief"]);
  assert.deepEqual(sentBy({ clientMessageId: h.agents.get(lead)!.sentIds.at(-1) }), ["answer"]);
  const again = await h.call(sup, "supervisor", "answer", { ask: "A1", text: "Half down.", keepsDefault: false });
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
  // The Supervisor may answer any ask, and its Lead is told.
  assert.equal(
    (await h.call(sup, "supervisor", "answer", { ask: ask.id, text: "Drop it and migrate.", keepsDefault: false })).ok,
    true,
  );
  assert.match(heard(h, peer), /Drop it and migrate/, "the Peer gets its answer");
  assert.match(heard(h, lead), new RegExp(`ANSWERED FOR YOU: ${ask.id}`), "the Lead holds the room's state");
  assert.match(heard(h, lead), /Drop it and migrate[^]*accepting it is still yours to judge/);
  await h.idle(peer);

  const rounding = await h.call(peer, "peer", "ask", {
    question: "Round half up or down?",
    tried: "read the spec",
    bestGuess: "half up",
  });
  assert.equal(rounding.ok, true, rounding.text);
  const waiting = Object.values(h.ledger().asks).at(-1)!.id;
  const start = Date.now();
  const waitedOn = () => Object.values(book(h)).filter((item) => item.kind === "ask-waiting");
  await h.tick(start + 14 * 60_000);
  assert.deepEqual(waitedOn(), [], "not before it has waited its while");
  for (const minutes of [16, 32, 48]) await h.tick(start + minutes * 60_000);
  const [fact] = waitedOn();
  assert.deepEqual(
    [waitedOn().length, fact!.seat, fact!.held],
    [1, lead, "shadow"],
    "an ask left waiting is a fact about its reader for the watch, in shadow",
  );
  assert.match(fact!.quote, new RegExp(`${waiting} \\(question\\) from L1-T1: Round half up or down\\?`));
  assert.doesNotMatch(
    `${heard(h, lead)}\n${heard(h, sup)}`,
    /STILL OPEN|UNANSWERED/,
    "no clock nags the reader or goes over its head: when to look is the watch's to say",
  );

  assert.equal(
    (await h.call(lead, "lead", "ask", { kind: "question", text: "Keep the old endpoint?", default: "keep it" })).ok,
    true,
  );
  const endpoint = Object.values(h.ledger().asks).at(-1)!.id;
  assert.match(
    (await h.call(sup, "supervisor", "status", {})).text,
    new RegExp(`- ${endpoint} question from lead .*: Keep the old endpoint\\? Going ahead meanwhile on: keep it\\n`),
    "what runs unconfirmed shows where whoever supervises follows progress",
  );
  const flow = await h.rpc(contracts.flow, { project: h.project.slug, open: [] });
  assert.ok("asks" in flow);
  assert.equal(flow.asks.find((ask) => ask.id === endpoint)?.default, "keep it", "and on the Human's panel");
  archive(h, sup);
  const next = h.add(SUPERVISOR, h.root, "sup-3");
  await h.tick(start + 80 * 60_000);
  assert.match(
    heard(h, next),
    /Keep the old endpoint\?/,
    "an ask to a reader since gone goes to whoever supervises now",
  );
  assert.equal(h.ledger().asks[endpoint]!.to, next);
});

test("with nobody supervising seated, an ask is kept and reaches whoever sits down first, with the asks it carries", async () => {
  const h = harness();
  const sup = h.add(SUPERVISOR, h.root, "sup");
  const { lead, peer } = await lane(h, sup, "Kept asks", "Parse");
  await h.call(peer, "peer", "ask", { question: "Which config file wins?", tried: "read the loader" });
  archive(h, sup);
  const need = await h.call(lead, "lead", "ask", { kind: "need", text: "Which?", default: "new", carries: ["A1"] });
  assert.match(need.text, /Asked as A2[^]*nobody supervising is seated[^]*Leave A1 open/);
  archive(h, lead);
  const question = await h.call(peer, "peer", "ask", { question: "Skip blank lines?", tried: "read the parser" });
  assert.match(question.text, /Asked as A3[^]*nobody can answer now/);
  const back = h.add(SUPERVISOR, h.root, "sup-2");
  await h.tick();
  assert.match(heard(h, back), /ASK A2 \(need\)[^]*Which\?[^]*Carries A1[^]*ASK A3 \(question\)[^]*Skip blank lines\?/);
  assert.deepEqual([h.ledger().asks.A2!.to, h.ledger().asks.A3!.to], [back, back]);
});

test("a Peer's silence is counted until it hands back, nudged, then told to its Lead, and a word from it undoes the stall", async () => {
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
  /** Its Lead answers the Peer's last ask: until then its quiet turns are waiting on it. */
  const answer = async () => {
    const last = Object.values(h.ledger().asks).at(-1)!;
    const answered = await h.call(lead, "lead", "answer", { ask: last.id, text: "That one.", keepsDefault: true });
    assert.equal(answered.ok, true, answered.text);
  };
  h.agents.get(peer)!.status = "idle";

  await turn("still reading");
  assert.equal(silent(), 1);
  assert.match(h.agents.get(peer)!.sent.at(-1)!, /without calling done or ask/);
  assert.match(h.agents.get(peer)!.sent.at(-1)!, /`done` and `ask` are tools of the `team` MCP server/);
  await turn("asked and waiting", ask);
  assert.equal(silent(), 1, "an ask is not a hand-back: a Peer once asked after each nudge, seven times over");
  await answer();
  await turn("Still looking.");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  assert.match(heard(h, lead), /SILENT L1-T1 \(Work\): its turn ended twice without a hand-back\./);
  assert.match(
    heard(h, lead),
    /SILENT L1-T1[\s\S]*Still looking[\s\S]*Next: If its last words hand the work back without calling done, message it to call done; else message it, or reseat it for a fresh Peer on its branch\./,
    "accept needs a hand-back on record, so it is not offered",
  );

  // Its Peer is still seated in the lane's copy, so a stalled task still holds it.
  const more = await h.call(lead, "lead", "add_tasks", { tasks: [task("More", "b.txt")] });
  assert.match(more.text, /L1-T2 More: held: L1-T1 is still writing/);
  assert.equal(h.ledger().tasks["L1-T2"]!.peer, undefined);
  const status = () => h.ledger().tasks["L1-T1"]!.status;
  await turn("Still at it.", async () => assert.equal(status(), "running", "a stalled Peer at work again runs"));
  assert.equal(status(), "stalled", "and one more quiet turn stalls it again");
  assert.match(heard(h, lead), /SILENT L1-T1 \(Work\): its turn ended 3 times without a hand-back\./);
  await turn("asked", ask);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "heard from, it runs again");
  await answer();
  await turn("applying it");
  assert.deepEqual(
    [h.ledger().tasks["L1-T1"]!.status, silent()],
    ["running", 1],
    "the stall its Lead saw is not counted again",
  );

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
    /its agent was closed or archived[\s\S]*Next: Nothing restarts it, and without a hand-back it cannot be accepted: reseat it for a fresh Peer that carries on from its branch, or cut it\./,
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
  const go = join(tempDir("crew-slow-"), "go");
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

  // An answer promised as mail that the outbox cannot take stays promised, so the next start still owns up to it.
  rmSync(go);
  const said = reported(t);
  const post = t.mock.method(h.runtime.outbox, "post", () => Promise.reject(new Error("the disk is full")));
  assert.match((await call("r3", lead, "lead", "report", report)).text, /still working on report/);
  writeFileSync(go, "");
  assert.ok(await within(5000, () => /could not be mailed[^]*the disk is full/.test(said())));
  const kept = JSON.parse(readFileSync(intentsPath(), "utf-8")) as { promised: { agent: string; tool: string }[] };
  const promised = kept.promised.map(({ agent, tool }) => `${agent} ${tool}`);
  assert.deepEqual(promised, [`${lead} report`], "still promised, so the next start owns up to it");
  post.mock.restore();

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

test("a running Lead is never cut into, whatever its agent: a message and its Peer's hand-back wait, and reach it as one when its turn ends", async (t) => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  await h.idle(lead);
  const seat = h.agents.get(lead)!;
  const before = seat.sent.length;
  seat.status = "running";
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  await h.beginTurn(lead);
  t.mock.timers.tick(10 * 60_000);
  const told = await h.call(sup, "supervisor", "message", { to: "L1", text: "Stop: the premise is wrong." });
  assert.match(told.text, /Queued for the Lead of L1/, "however long its turn has run");
  h.commit(h.ledger().tasks["L1-T1"]!.worktree!, "a.txt", "A\n");
  assert.equal((await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" })).ok, true);
  await h.tick();
  assert.equal(seat.sent.length, before, "nothing cuts into a turn it thinks or writes in");
  await h.idle(lead);
  assert.match(seat.sent.at(-1)!, /^2 messages[^]*the premise is wrong[^]*HANDBACK L1-T1 /, "both, in one message");
});

test("word held for a seat rides the reply to its own call inside a turn, and wakes nobody", async () => {
  const h = harness();
  const sup = h.add(SUPERVISOR, h.root, "sup");
  let n = 0;
  const status = (stop = new AbortController()) =>
    h.runtime.answer(
      { id: `c${++n}`, agent: sup, role: "supervisor", tool: "status", args: {}, cwd: h.root, at: Date.now() },
      stop.signal,
    );
  await h.idle(sup);
  await h.runtime.outbox.post({ to: sup, key: "land:L1:landed", text: "LANDED L1 (Cart)", wakes: false });
  h.agents.get(sup)!.status = "running";
  await h.beginTurn(sup);
  const stopped = new AbortController();
  stopped.abort();
  assert.doesNotMatch((await status(stopped)).text, /LANDED L1/, "a reply nobody will read carries nothing");
  assert.match((await status()).text, /\n\n---\n\nMail the desk held for you:\n\n[^]*LANDED L1 \(Cart\)/);
  assert.deepEqual(h.runtime.outbox.pending(sup), []);
  h.agents.get(sup)!.status = "idle";
  await h.endTurn(sup, "L1 has landed.");
  assert.deepEqual(h.agents.get(sup)!.sent, [], "nothing is sent to start another turn");
});

test("a Peer reads the mail held for it before its ask or hand-back is taken, so neither rests on what it has not read", async () => {
  const h = harness();
  const sup = h.add(SUPERVISOR, h.root, "sup");
  const { lead, peer } = await lane(h, sup, "Pricing", "Round");
  let n = 0;
  const call = (tool: string, args: Record<string, unknown>) =>
    h.runtime.answer(
      { id: `p${++n}`, agent: peer, role: "peer", tool, args, cwd: h.root, at: Date.now() },
      new AbortController().signal,
    );
  await call("ask", { question: "Half up or even?" });
  await h.call(lead, "lead", "answer", { ask: "A1", text: "Half up." });
  const again = await call("ask", { question: "Half up or even, then?" });
  assert.equal(again.ok, false);
  assert.match(again.text, /mail that changes your work came for you[^]*Mail the desk held for you:[^]*Half up\./);
  assert.equal(h.ledger().asks.A2, undefined, "the answer it waited for, not a second ask");

  await h.call(lead, "lead", "amend_task", { task: "L1-T1", why: "rates too", acceptance: ["a", "b"] });
  await h.call(lead, "lead", "message", { to: "L1-T1", text: "Check the rates as well." });
  h.commit(h.ledger().tasks["L1-T1"]!.worktree!, "a.txt", "round\n");
  const early = await call("done", { outcome: "partial", summary: "rounded" });
  assert.equal(early.ok, false);
  for (const said of [/AMENDED L1-T1/, /Check the rates as well/]) assert.match(early.text, said);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "nothing handed back on a contract it had not read");
  const done = await call("done", { outcome: "complete", summary: "rounded, rates too" });
  assert.equal(done.ok, true, done.text);
  const task = h.ledger().tasks["L1-T1"]!;
  assert.deepEqual([task.status, task.reworks], ["done", undefined], "no send-back to carry word it already had");
});
