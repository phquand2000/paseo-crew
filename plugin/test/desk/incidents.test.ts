import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { tempDir } from "../../server/core/testing.ts";
import { DeskContext } from "../../server/desk/context.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadIncidents } from "../../server/desk/incidents.ts";
import { emptyLedger, saveLedger } from "../../server/desk/ledger.ts";
import { closeIncidentsOf, judge, notice, retell } from "../../server/desk/notice.ts";
import type { DeskServices } from "../../server/desk/services.ts";
import { ack, incidents } from "../../server/desk/tools/incidents.ts";
import { decide, weigh } from "../../server/runtime/watch/rules.ts";
import { labelsIn } from "../../bin/calibrate.ts";

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const questions = Object.values(kit.sensors)[0]!.questions;

function desk(watching = false, sensing = false) {
  const machine: Record<string, unknown> = { ...(watching ? { attention: { watch: true } } : {}), ...(sensing ? { sensor: { key: "k" } } : {}) };
  const root = tempDir("sw2-incidents-");
  const project = { root, slug: "p", state: join(root, "state") };
  const posted: { to: string; key: string; text: string }[] = [];
  const seated = { supervisor: undefined as string | undefined };
  const ctx = new DeskContext({
    kit,
    outbox: { post: async (letter) => (posted.push(letter), "sent") },
    log: () => {},
    teamFor: () => resolveTeam(kit, machine),
    indexesFor: () => [],
  });
  const roster = { supervisorFor: async () => seated.supervisor };
  const services = { ctx, roster } as unknown as DeskServices;
  const supervisor = { id: "sup", role: kit.roles.find((role) => role.role === "supervisor")!, title: "sup", project };
  return { project, services, supervisor, posted, seated, machine };
}

const stuck = { kind: "stuck", level: "attend" as const, quote: "the same action failing 3 times", facts: ["stuck"] };

test("the same thing seen of one seat, however often and however concurrently, is one incident", async () => {
  const { project, services } = desk();
  const seat = { id: "peer-1", title: "Peer", provider: "sw2-peer-devin/swe-2-max" };
  const results = await Promise.all([notice(services, project, seat, [stuck]), notice(services, project, seat, [stuck]), notice(services, project, seat, [{ ...stuck, quote: "again" }])]);
  assert.equal(results.flatMap((result) => result.opened).length, 1, "only the first sighting opens anything");
  const held = loadIncidents(project.state);
  const items = Object.values(held.items);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.count, 3);
  assert.equal(items[0]!.quote, "again", "the latest words are kept");
  await notice(services, project, { id: "peer-2", provider: "sw2-peer-devin/swe-2-max" }, [stuck]);
  await notice(services, project, seat, [{ kind: "destructive", level: "page", quote: "rm -rf /", facts: ["destructive"] }]);
  assert.equal(Object.keys(loadIncidents(project.state).items).length, 3, "another seat, or another kind, is another incident");
});

test("a mark goes on the incident named and closes it, and a later sighting opens a new one", async () => {
  const { project, services, supervisor } = desk();
  await notice(services, project, { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" }, [stuck]);
  await notice(services, project, { id: "peer-2", provider: "sw2-peer-devin/swe-2-max" }, [stuck]);
  assert.equal((await ack(services, supervisor, { id: "I9", verdict: "useful" })).ok, false);
  assert.equal((await ack(services, supervisor, { id: "I1", verdict: "maybe" })).ok, false);
  const reply = await ack(services, supervisor, { id: "I2", verdict: "noise", note: "expected: a normal retry of `curl -H 'Authorization: Bearer 9f8e7d6c5b4a39281706'`" });
  assert.equal(reply.ok, true, reply.text);
  const held = loadIncidents(project.state).items;
  assert.equal(held.I2!.label, "noise");
  assert.doesNotMatch(held.I2!.note!, /9f8e7d6c5b4a39281706/, "a secret quoted in a note is masked before it is kept");
  assert.match(held.I2!.note!, /^expected: a normal retry/);
  assert.equal(held.I2!.open, false);
  assert.equal(held.I1!.label, undefined, "the other incident is untouched");
  assert.equal(held.I1!.open, true);
  const reopened = await notice(services, project, { id: "peer-2", provider: "sw2-peer-devin/swe-2-max" }, [stuck]);
  assert.deepEqual(reopened.opened.map((incident) => incident.id), ["I3"]);
  const listed = await incidents(services, supervisor, {});
  assert.match(listed.text, /2 not yet marked:/);
  assert.match(listed.text, /I3 \[attend/);
});

test("a question alone raises on two readings in a running turn or one at its end, or at once when irreversible; one tied to a fact confirms it rather than raising its own", () => {
  const unclear = Object.values(kit.sensors)[0]!.unclear;
  const noted = [{ kind: "outside-scope", level: "note" as const, quote: "/etc/hosts" }, { kind: "stuck", level: "attend" as const, quote: "q" }];
  const answers = Object.fromEntries(Object.keys(questions).map((name) => [name, 0.99]));
  const once = weigh({ answers, model: "typesafe/jev-1.13-20260917" }, questions, noted, { unclear, ended: false });
  assert.deepEqual(once.findings.map((finding) => finding.kind), ["unsafe_action", "goal_drift"], "needs_human waits for a second reading; worker_stuck opens nothing of its own; injected_intent only records");
  assert.equal(once.findings[0]!.level, "page", "what is irreversible goes first, and at once");
  assert.deepEqual(once.verdicts.map((verdict) => [verdict.kind, verdict.question, verdict.says]), [["stuck", "worker_stuck", "confirms"]]);
  assert.ok(weigh({ answers, model: "m" }, questions, noted, { unclear, ended: false, before: answers }).findings.some((finding) => finding.kind === "needs_human"));
  assert.ok(weigh({ answers, model: "m" }, questions, noted, { unclear, ended: true }).findings.some((finding) => finding.kind === "needs_human"), "a turn that has ended gets no second reading, so one is enough");
  const close = weigh({ answers: { unsafe_action: 0.6, worker_stuck: 0.6 }, model: "m" }, questions, noted, { unclear, ended: false });
  assert.deepEqual(close.findings.map((finding) => [finding.kind, finding.level]), [["unsafe_action", "attend"]], "an unclear answer on an irreversible act is never let pass");
  assert.equal(close.verdicts[0]!.says, "unclear");
  assert.equal(weigh({ answers: { worker_stuck: 0.5 }, model: "m" }, questions, noted, { unclear, ended: false }).verdicts[0]!.says, "unclear", "the band's lower edge is in the band");
  assert.equal(weigh({ answers: { worker_stuck: 0.2 }, model: "m" }, questions, noted, { unclear, ended: false }).verdicts[0]!.says, "vetoes");
  assert.deepEqual(decide([{ kind: "call-failed", level: "note", quote: "x" }]), [], "a note is evidence for the sensor, not an incident on its own");
});

test("a fact the sensor can judge waits for it, is held back when it disagrees, sent when it agrees, and sent anyway if it never answers", async () => {
  const { project, services, posted, seated } = desk(true, true);
  seated.supervisor = "sup";
  const peer = { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" };
  const other = { id: "peer-2", provider: "sw2-peer-devin/swe-2-max" };
  const late = { id: "peer-3", provider: "sw2-peer-devin/swe-2-max" };
  const at = Date.now();
  for (const seat of [peer, other, late]) await notice(services, project, seat, [stuck], at);
  assert.deepEqual(Object.values(loadIncidents(project.state).items).map((item) => item.held), ["awaiting", "awaiting", "awaiting"]);
  assert.equal(posted.length, 0);
  const verdict = (says: "confirms" | "vetoes", p: number) => [{ kind: "stuck", question: "worker_stuck", p, model: "m", says }];
  assert.deepEqual(await judge(services, project, peer, verdict("vetoes", 0.1), at + 1000), []);
  assert.deepEqual(await judge(services, project, other, verdict("confirms", 0.9), at + 1000), ["I2"]);
  assert.doesNotMatch(posted[0]!.text, /worker_stuck|0\.9/, "the letter carries no score and no view of the sensor's, so the mark made on it rests on the record");
  assert.deepEqual(await judge(services, project, other, verdict("vetoes", 0.1), at + 2000), [], "once told, a later reading changes nothing");
  assert.equal(loadIncidents(project.state).items.I2!.sensor!.says, "confirms", "and the judgement it was sent on is the one kept");
  assert.equal(posted.length, 1);
  assert.deepEqual(await retell(services, project, at + 60_000), [], "not yet overdue");
  assert.deepEqual(await retell(services, project, at + 121_000), ["I3"], "a sensor that never answers holds nothing back for long");
  const items = loadIncidents(project.state).items;
  assert.equal(items.I1!.held, "vetoed");
  assert.equal(items.I1!.sensor!.p, 0.1);
  assert.deepEqual(await judge(services, project, peer, verdict("confirms", 0.85), at + 150_000), ["I1"], "held back, it is still sent once the sensor comes to agree");
  const page = await notice(services, project, late, [{ kind: "destructive", level: "page", quote: "rm -rf /", facts: ["destructive"] }], at);
  assert.deepEqual(page.sent, ["I4"], "an irreversible act never waits");
});

test("a veto holds back only what it judged: the next sighting waits for the sensor again, and nothing stays held once the sensor is gone", async () => {
  const { project, services, seated, machine } = desk(true, true);
  seated.supervisor = "sup";
  const peer = { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" };
  const other = { id: "peer-2", provider: "sw2-peer-devin/swe-2-max" };
  const at = Date.now();
  for (const seat of [peer, other]) {
    await notice(services, project, seat, [stuck], at);
    await judge(services, project, seat, [{ kind: "stuck", question: "worker_stuck", p: 0.1, model: "m", says: "vetoes" }], at + 1000);
  }
  await notice(services, project, peer, [{ ...stuck, quote: "stuck again, in a later instruction" }], at + 600_000);
  assert.equal(loadIncidents(project.state).items.I1!.held, "awaiting", "new evidence is judged afresh");
  assert.deepEqual(await retell(services, project, at + 600_000 + 121_000), ["I1"], "and sent if the sensor does not answer");
  delete machine.sensor;
  assert.deepEqual(await retell(services, project, at + 700_000), ["I2"], "with no sensor configured, nothing it held back stays held");
});

test("a doubtful reading raised at attention does not swallow the certain one that follows: that one pages", async () => {
  const { project, services, posted, seated } = desk(true);
  seated.supervisor = "sup";
  const peer = { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" };
  const unsafe = (level: "page" | "attend", p: number) => [{ kind: "unsafe_action", level, quote: `p=${p}`, facts: [], p }];
  assert.deepEqual((await notice(services, project, peer, unsafe("attend", 0.55))).sent, ["I1"]);
  assert.deepEqual((await notice(services, project, peer, unsafe("page", 0.97))).sent, ["I1"]);
  assert.equal(posted.length, 2);
  assert.match(posted[1]!.text, /INCIDENT I1 \(unsafe_action, page\)[\s\S]*p=0\.97/);
  assert.notEqual(posted[0]!.key, posted[1]!.key, "the page is a letter of its own, not a repeat of the attention one");
  await notice(services, project, peer, unsafe("page", 0.99));
  assert.equal(posted.length, 2, "told once as a page, then quiet");
});

test("what was held because nobody could be told is told on its next sighting once somebody can, and only then goes quiet", async () => {
  const { project, services, posted, seated } = desk(true);
  const peer = { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" };
  const page = (quote: string) => [{ kind: "destructive", level: "page" as const, quote, facts: ["destructive"] }];
  await notice(services, project, peer, page("rm -rf build"));
  assert.equal(loadIncidents(project.state).items.I1!.held, "nobody");
  seated.supervisor = "sup";
  const second = await notice(services, project, peer, page("git push --force origin main"));
  assert.deepEqual(second.sent, ["I1"]);
  assert.equal(posted.length, 1);
  assert.match(posted[0]!.text, /INCIDENT I1 \(destructive, page\)[\s\S]*git push --force origin main/);
  await notice(services, project, peer, page("rm -rf dist"));
  assert.equal(posted.length, 1, "told once, then quiet");
  assert.equal(loadIncidents(project.state).items.I1!.quote, "git push --force origin main", "what the Supervisor was told is what stays on record");
});

test("an incident book that cannot be read is refused rather than started again from nothing", async () => {
  const { project, services, supervisor } = desk(true);
  mkdirSync(project.state, { recursive: true });
  writeFileSync(join(project.state, "incidents.json"), "{ not json");
  await assert.rejects(notice(services, project, { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" }, [stuck]), /could not be read: [\s\S]*Nothing was written over it/);
  assert.equal((await incidents(services, supervisor, {})).ok, false);
});

test("an incident closed because its seat went away still waits to be marked", async () => {
  const { project, services, supervisor } = desk();
  await notice(services, project, { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" }, [stuck]);
  await closeIncidentsOf(services, project, "peer-1");
  const listed = await incidents(services, supervisor, {});
  assert.match(listed.text, /I1 \[attend, closed, not sent: shadow, not marked\]/);
  assert.equal((await ack(services, supervisor, { id: "I1", verdict: "useful" })).ok, true);
  assert.match((await incidents(services, supervisor, {})).text, /Nothing waiting to be marked/);
});

test("what was held for nobody is told by the round once somebody sits down, and a sighting after the letter is kept beside what was told", async () => {
  const { project, services, supervisor, posted, seated } = desk(true);
  const peer = { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" };
  await notice(services, project, peer, [{ kind: "destructive", level: "page", quote: "rm -rf src", facts: ["destructive"] }]);
  assert.deepEqual(await retell(services, project), [], "nobody yet");
  seated.supervisor = "sup";
  assert.deepEqual(await retell(services, project), ["I1"]);
  assert.match(posted[0]!.text, /rm -rf src/);
  assert.deepEqual(await retell(services, project), [], "told once");
  await notice(services, project, peer, [{ kind: "destructive", level: "page", quote: "git push --force origin main", facts: ["destructive"] }]);
  const acked = await ack(services, supervisor, { id: "I1", verdict: "useful" });
  assert.match(acked.text, /after you were told: git push --force origin main/);
  assert.equal(loadIncidents(project.state).items.I1!.quote, "rm -rf src");
});

test("an incident is never addressed to the seat it is about", async () => {
  const { project, services, posted, seated } = desk(true);
  seated.supervisor = "peer-1";
  const result = await notice(services, project, { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" }, [{ kind: "destructive", level: "page", quote: "rm -rf build", facts: ["destructive"] }]);
  assert.deepEqual(result.sent, []);
  assert.deepEqual(posted, []);
  assert.equal(loadIncidents(project.state).items.I1!.held, "nobody");
});

test("a mark outlives the incident it was put on, so the thresholds are still tuned from it once the book has let the incident go", async () => {
  const { project, services, supervisor } = desk(false, true);
  const peer = { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" };
  await notice(services, project, peer, [stuck]);
  await judge(services, project, peer, [{ kind: "stuck", question: "worker_stuck", p: 0.3, model: "m", says: "vetoes" }]);
  assert.equal(loadIncidents(project.state).items.I1!.held, "shadow", "in shadow the sensor's word is kept, and nothing is sent either way");
  assert.equal((await ack(services, supervisor, { id: "I1", verdict: "useful" })).ok, true);
  const held = loadIncidents(project.state);
  const opened = held.items.I1!.opened;
  delete held.items.I1;
  writeFileSync(join(project.state, "incidents.json"), JSON.stringify(held));
  const [label, ...rest] = labelsIn(project.state);
  assert.deepEqual(rest, []);
  const { closed, ...kept } = label!;
  assert.ok(closed! >= opened);
  assert.deepEqual(kept, { id: "I1", seat: "peer-1", kind: "stuck", opened, last: opened, sensor: { question: "worker_stuck", p: 0.3, model: "m", says: "vetoes" }, label: "useful" });
});

test("the list carries what each seat was asked, and a mark the record cannot settle is kept out of what the thresholds are tuned from", async () => {
  const { project, services, supervisor } = desk();
  const ledger = emptyLedger();
  ledger.tasks["L1-T1"] = { id: "L1-T1", lane: "L1", kind: "code", mode: "lane", title: "Empty cart message", goal: "show the empty cart message", acceptance: ["empty cart renders it"], owned: ["src/cart/**"], outOfScope: ["checkout"], peer: "peer-1", status: "working", openedAt: 1, updatedAt: 1, silent: 0 } as never;
  mkdirSync(project.state, { recursive: true });
  saveLedger(project.state, ledger);
  await notice(services, project, { id: "peer-1", provider: "sw2-peer-devin/swe-2-max" }, [stuck]);
  await notice(services, project, { id: "peer-2", provider: "sw2-peer-devin/swe-2-max" }, [stuck]);
  const listed = (await incidents(services, supervisor, {})).text;
  assert.match(listed, /What they were asked:\n- L1-T1 Empty cart message: goal show the empty cart message; acceptance empty cart renders it; owned src\/cart\/\*\*; out of scope checkout/);
  assert.equal((await ack(services, supervisor, { id: "I1", verdict: "unknown", note: "the record does not show what npm run build printed" })).ok, true);
  assert.equal((await ack(services, supervisor, { id: "I2", verdict: "useful" })).ok, true);
  assert.deepEqual(labelsIn(project.state).map((label) => [label.id, label.label]), [["I2", "useful"]]);
});
