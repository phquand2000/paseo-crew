import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { saveIncidents } from "../../server/desk/incidents.ts";
import { projectOf } from "../../server/desk/project.ts";
import { laneWithPeer, repo } from "./harness.ts";
import { book, notice } from "./noticed.ts";

test("what was held because nobody could read it is told once somebody can, and never to the seat it is about", async () => {
  const { h, sup, lane, peer } = await laneWithPeer({ attention: { watch: true } });
  const seated = (yes: boolean) => void (h.agents.get(sup)!.archivedAt = yes ? null : new Date().toISOString());
  const told = (id: string) => h.heard(sup).filter((text) => text.includes(`INCIDENT ${id} `));
  const second = repo();
  const other = projectOf(second.root);
  mkdirSync(other.state, { recursive: true });
  writeFileSync(join(other.state, "settings.json"), JSON.stringify({ attention: { watch: true } }));
  const supB = h.add("sw2-supervisor-claude/claude-opus-5", second.root, "sup-b");

  seated(false);
  await notice(h, peer, "destructive", "page", "rm -rf build");
  assert.equal(book(h).I1!.held, "nobody");
  seated(true);
  assert.deepEqual((await notice(h, peer, "destructive", "page", "git push --force origin main")).sent, ["I1"]);
  assert.match(
    told("I1").join("\n"),
    /INCIDENT I1 \(destructive, page\)[\s\S]*git push --force origin main/,
    "on its next sighting, in the latest words",
  );
  await notice(h, peer, "destructive", "page", "rm -rf dist");
  assert.equal(told("I1").length, 1, "told once, then quiet");
  assert.equal(
    book(h).I1!.quote,
    "git push --force origin main",
    "what the Supervisor was told is what stays on record",
  );
  assert.equal((await h.call(sup, "supervisor", "mark_incident", { id: "I1", verdict: "useful" })).ok, true);

  seated(false);
  await notice(h, peer, "destructive", "page", "rm -rf src");
  await h.tick();
  assert.deepEqual(told("I2"), [], "nobody yet");
  seated(true);
  await h.tick();
  await h.tick();
  assert.equal(told("I2").length, 1, "the round tells it once somebody sits down, and once only");
  assert.match(told("I2").join("\n"), /rm -rf src/);
  await notice(h, peer, "destructive", "page", "git push --force origin main");
  const acked = await h.call(sup, "supervisor", "mark_incident", { id: "I2", verdict: "useful" });
  assert.match(
    acked.text,
    /after you were told: git push --force origin main/,
    "a sighting after the letter is kept beside it",
  );
  assert.equal(book(h).I2!.quote, "rm -rf src");

  seated(false);
  await notice(h, lane.lead!, "stuck");
  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ attention: {} }));
  await notice(h, peer, "destructive", "page", "rm -rf lib");
  seated(true);
  await h.tick();
  assert.deepEqual(
    [told("I3").length, told("I4").length],
    [0, 1],
    "with mail off, only the page held for nobody is told",
  );

  const self = await notice(h, sup, "destructive", "page", "rm -rf build");
  assert.deepEqual(self.sent, [], "an incident is never addressed to the seat it is about");
  assert.equal(book(h).I5!.held, "nobody");

  await notice(
    h,
    { id: "p-b", provider: "sw2-peer-claude/claude-opus-5" },
    "destructive",
    "page",
    "rm -rf build",
    other,
  );
  assert.match(
    h.heard(supB).join("\n"),
    /INCIDENT I1 \(destructive, page\)/,
    "the second project's owner is told of its own I1, not dropped as a repeat of the first's",
  );
});

test("a lane's own record raises an incident about its Lead once, held while the watch is off, never about a Lead that is gone", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const rework = async (round: number) => {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lead, "lead", "rework", { task: "L1-T1", text: "not yet" });
  };
  for (const round of [1, 2, 3]) await rework(round);
  assert.equal(h.ledger().tasks["L1-T1"]!.reworks, 3, "three sendings-back are on the record");
  await h.tick();
  assert.deepEqual(
    Object.values(book(h)).map((item) => [item.kind, item.held]),
    [["rework-loop", "shadow"]],
    "a lane's record is gone through for what no turn shows, held while the watch is off",
  );
  assert.doesNotMatch(h.heard(sup).join("\n"), /INCIDENT/);

  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ attention: { watch: true } }));
  await h.tick();
  const told = h.heard(sup).join("\n");
  assert.match(
    told,
    /INCIDENT I1 \(rework-loop, attend\) on the Lead of L1 \(Build\)/,
    "told once turned on, about the seat that decides to send it back",
  );
  assert.match(told, /What was seen: L1-T1 \(Clean build\) has been sent back 3 times/);
  assert.deepEqual(Object.keys(book(h)), ["I1"], "the incident already on the book, not a second one");
  assert.doesNotMatch(h.heard(lead).join("\n"), /INCIDENT/, "never shown to the Lead it is about");

  const marked = await h.call(sup, "supervisor", "mark_incident", {
    id: "I1",
    verdict: "noise",
    note: "expected: the brief changed under it",
  });
  assert.equal(marked.ok, true, marked.text);
  await h.tick();
  await h.tick();
  assert.deepEqual(Object.keys(book(h)), ["I1"], "the same three sendings-back are not raised again once marked");
  await rework(4);
  await h.tick();
  assert.deepEqual(Object.keys(book(h)), ["I1", "I2"], "a fourth sending-back is something new to say");

  assert.equal((await h.call(sup, "supervisor", "mark_incident", { id: "I2", verdict: "noise" })).ok, true);
  await rework(5);
  h.agents.get(lead)!.archivedAt = new Date().toISOString();
  await h.tick();
  assert.deepEqual(
    Object.keys(book(h)),
    ["I1", "I2"],
    "an incident about a Lead that has gone is one nobody can close",
  );
});

const quote = "the same action failing 3 times: Bash: npm test";

test("nothing reaches a seat that names or quotes an open incident about it, while its own words about the work do", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const now = Date.now();
  const about = (id: string, seat: string) => ({
    id,
    seat,
    where: "L1",
    kind: "stuck",
    level: "attend" as const,
    quote,
    facts: ["stuck"],
    opened: now,
    last: now,
    count: 1,
    open: true,
  });
  saveIncidents(h.project.state, { next: 3, items: { I1: about("I1", peer), I2: about("I2", lane.lead!) } });
  const refusal = /That repeats incident I1 about the seat it goes to/;

  assert.match(
    (await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: "About i1: why did that happen?" })).text,
    refusal,
  );
  assert.match(
    (await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: `You hit ${quote.toUpperCase()}.` })).text,
    refusal,
  );
  assert.match(
    (await h.call(lane.lead!, "lead", "amend_task", { task: "L1-T1", why: `because of ${quote}`, goal: "g2" })).text,
    refusal,
  );
  assert.match((await h.call(sup, "supervisor", "message", { to: "L1-T1", text: `See I1.` })).text, refusal);
  assert.match(
    (await h.call(sup, "supervisor", "message", { to: "L1", text: `${quote}?` })).text,
    /That repeats incident I2/,
  );
  assert.match(
    (
      await h.call(sup, "supervisor", "amend_lane", {
        lane: "L1",
        why: "the Human changed it",
        acceptance: [`no more ${quote}`],
      })
    ).text,
    /That repeats incident I2/,
  );
  assert.equal(
    (
      await h.call(lane.lead!, "lead", "message", {
        to: "L1-T1",
        text: "Your test run keeps failing the same way; what does the first failure say?",
      })
    ).ok,
    true,
  );

  await h.call(peer, "peer", "ask", { question: "Which rounding?", bestGuess: "half up" });
  assert.match((await h.call(lane.lead!, "lead", "answer", { ask: "A1", text: "Half up. Also I1." })).text, refusal);
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  assert.match((await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: `Stop: ${quote}.` })).text, refusal);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "done", "a refused rework sends the task nowhere");
});
