import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { tempDir } from "../tempdir.ts";
import { DeskContext } from "../../server/desk/context.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadIncidents } from "../../server/desk/incidents.ts";
import { emptyLedger, saveLedger } from "../../server/desk/ledger.ts";
import { closeIncidentsOf, notice, retell } from "../../server/desk/notice.ts";
import type { DeskServices } from "../../server/desk/services.ts";
import { markIncident } from "../../server/desk/tools/mark-incident.ts";
import { incidents } from "../../server/desk/tools/incidents.ts";
import { decide } from "../../server/runtime/watch/findings.ts";

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

/** `mailing` is the Human's switch: off, what the code notices is recorded and only pages are told. */
function desk(mailing = false) {
  const machine: { attention: { watch?: boolean } } = { attention: mailing ? { watch: true } : {} };
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
  const seat = { id: "peer-1", title: "Peer", provider: "sw2-peer-claude/claude-opus-5" };
  const results = await Promise.all([notice(services, project, seat, [stuck]), notice(services, project, seat, [stuck]), notice(services, project, seat, [{ ...stuck, quote: "again" }])]);
  assert.equal(results.flatMap((result) => result.opened).length, 1, "only the first sighting opens anything");
  const held = loadIncidents(project.state);
  const items = Object.values(held.items);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.count, 3);
  assert.equal(items[0]!.quote, "again", "the latest words are kept");
  await notice(services, project, { id: "peer-2", provider: "sw2-peer-claude/claude-opus-5" }, [stuck]);
  await notice(services, project, seat, [{ kind: "destructive", level: "page", quote: "rm -rf /", facts: ["destructive"] }]);
  assert.equal(Object.keys(loadIncidents(project.state).items).length, 3, "another seat, or another kind, is another incident");
});

test("a mark goes on the incident named and closes it, and a sighting of something else opens a new one", async () => {
  const { project, services, supervisor } = desk();
  await notice(services, project, { id: "peer-1", provider: "sw2-peer-claude/claude-opus-5" }, [stuck]);
  await notice(services, project, { id: "peer-2", provider: "sw2-peer-claude/claude-opus-5" }, [stuck]);
  assert.equal((await markIncident.handle(services, supervisor, { id: "I9", verdict: "useful" })).ok, false);
  const reply = await markIncident.handle(services, supervisor, { id: "I2", verdict: "noise", note: "expected: a normal retry of `curl -H 'Authorization: Bearer 9f8e7d6c5b4a39281706'`" });
  assert.equal(reply.ok, true, reply.text);
  const held = loadIncidents(project.state).items;
  assert.equal(held.I2!.label, "noise");
  assert.doesNotMatch(held.I2!.note!, /9f8e7d6c5b4a39281706/, "a secret quoted in a note is masked before it is kept");
  assert.match(held.I2!.note!, /^expected: a normal retry/);
  assert.equal(held.I2!.open, false);
  assert.equal(held.I1!.label, undefined, "the other incident is untouched");
  assert.equal(held.I1!.open, true);
  // The same words again are counted on the mark, so a standing condition is not asked about per sighting.
  const reopened = await notice(services, project, { id: "peer-2", provider: "sw2-peer-claude/claude-opus-5" }, [{ ...stuck, quote: "the same action failing 3 times: npm run build" }]);
  assert.deepEqual(reopened.opened.map((incident) => incident.id), ["I3"]);
  const listed = await incidents.handle(services, supervisor, {});
  assert.match(listed.text, /2 not yet marked:/);
  assert.match(listed.text, /I3 \[attend/);
});

test("a fact at note level is kept as evidence and opens no incident; a page is ranked first", () => {
  assert.deepEqual(decide([{ kind: "call-failed", level: "note", quote: "x" }]), []);
  const ranked = decide([{ kind: "stuck", level: "attend", quote: "q" }, { kind: "destructive", level: "page", quote: "rm -rf /" }]);
  assert.deepEqual(ranked.map((finding) => finding.kind), ["destructive", "stuck"]);
});

test("what was held because nobody could be told is told on its next sighting once somebody can, and only then goes quiet", async () => {
  const { project, services, posted, seated } = desk(true);
  const peer = { id: "peer-1", provider: "sw2-peer-claude/claude-opus-5" };
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
  await assert.rejects(notice(services, project, { id: "peer-1", provider: "sw2-peer-claude/claude-opus-5" }, [stuck]), /could not be read: [\s\S]*Nothing was written over it/);
  assert.equal((await incidents.handle(services, supervisor, {})).ok, false);
});

test("an incident closed because its seat went away still waits to be marked", async () => {
  const { project, services, supervisor } = desk();
  await notice(services, project, { id: "peer-1", provider: "sw2-peer-claude/claude-opus-5" }, [stuck]);
  await closeIncidentsOf(services, project, "peer-1");
  const listed = await incidents.handle(services, supervisor, {});
  assert.match(listed.text, /I1 \[attend, closed, not sent: shadow, not marked\]/);
  assert.equal((await markIncident.handle(services, supervisor, { id: "I1", verdict: "useful" })).ok, true);
  assert.match((await incidents.handle(services, supervisor, {})).text, /Nothing waiting to be marked/);
});

test("what was held for nobody is told by the round once somebody sits down, and a sighting after the letter is kept beside what was told", async () => {
  const { project, services, supervisor, posted, seated } = desk(true);
  const peer = { id: "peer-1", provider: "sw2-peer-claude/claude-opus-5" };
  await notice(services, project, peer, [{ kind: "destructive", level: "page", quote: "rm -rf src", facts: ["destructive"] }]);
  assert.deepEqual(await retell(services, project), [], "nobody yet");
  seated.supervisor = "sup";
  assert.deepEqual(await retell(services, project), ["I1"]);
  assert.match(posted[0]!.text, /rm -rf src/);
  assert.deepEqual(await retell(services, project), [], "told once");
  await notice(services, project, peer, [{ kind: "destructive", level: "page", quote: "git push --force origin main", facts: ["destructive"] }]);
  const acked = await markIncident.handle(services, supervisor, { id: "I1", verdict: "useful" });
  assert.match(acked.text, /after you were told: git push --force origin main/);
  assert.equal(loadIncidents(project.state).items.I1!.quote, "rm -rf src");
});

test("with mail off, a page held for nobody is still told once somebody sits down, and the rest waits for mail", async () => {
  const { project, services, posted, seated, machine } = desk(true);
  const peer = { id: "peer-1", provider: "sw2-peer-claude/claude-opus-5" };
  await notice(services, project, peer, [stuck]);
  machine.attention = {};
  await notice(services, project, peer, [{ kind: "destructive", level: "page", quote: "rm -rf src", facts: ["destructive"] }]);
  seated.supervisor = "sup";
  assert.deepEqual(await retell(services, project), ["I2"]);
  assert.deepEqual(posted.map((letter) => letter.to), ["sup"]);
  assert.match(posted[0]!.text, /rm -rf src/);
});

test("a condition the Supervisor marked noise is counted, not raised again, unless it pages", async () => {
  const { project, services, supervisor, posted, seated } = desk(true);
  seated.supervisor = "sup";
  const peer = { id: "peer-1", provider: "sw2-peer-claude/claude-opus-5" };
  // A standing condition, seen in the same words on every sighting.
  const absent = [{ kind: "stuck", level: "attend" as const, quote: "npm run build failed 3 times: src/pointer.js does not exist yet", facts: ["stuck"] }];
  await notice(services, project, peer, absent);
  assert.equal((await markIncident.handle(services, supervisor, { id: "I1", verdict: "noise", note: "expected: it is being written in parallel by L1-T1" })).ok, true);

  const again = await notice(services, project, peer, absent);
  assert.deepEqual(again.opened, [], "the same words, already marked noise on this seat: nothing new is opened");
  const book = loadIncidents(project.state).items;
  assert.deepEqual(Object.keys(book), ["I1"], "and no second incident is written");
  assert.equal(book.I1!.count, 2, "it is counted, so `incidents` still says how often it was seen");
  assert.equal(posted.length, 1, "the Supervisor is not asked about it twice");

  // Different words are a different thing, and an irreversible act pages however often it is excused.
  await notice(services, project, peer, [{ ...absent[0]!, quote: "npm run build failed 3 times: src/patch.js does not exist yet" }]);
  await notice(services, project, peer, [{ kind: "destructive", level: "page", quote: "rm -rf /tmp/verify-t1", facts: [] }]);
  assert.equal((await markIncident.handle(services, supervisor, { id: "I3", verdict: "noise", note: "expected: its own scratch directory" })).ok, true);
  await notice(services, project, peer, [{ kind: "destructive", level: "page", quote: "rm -rf /tmp/verify-t1", facts: [] }]);
  assert.deepEqual(Object.keys(loadIncidents(project.state).items), ["I1", "I2", "I3", "I4"], "a page is never settled away");
});

test("an incident is never addressed to the seat it is about", async () => {
  const { project, services, posted, seated } = desk(true);
  seated.supervisor = "peer-1";
  const result = await notice(services, project, { id: "peer-1", provider: "sw2-peer-claude/claude-opus-5" }, [{ kind: "destructive", level: "page", quote: "rm -rf build", facts: ["destructive"] }]);
  assert.deepEqual(result.sent, []);
  assert.deepEqual(posted, []);
  assert.equal(loadIncidents(project.state).items.I1!.held, "nobody");
});

test("the list carries what each seat was asked", async () => {
  const { project, services, supervisor } = desk();
  const ledger = emptyLedger();
  ledger.tasks["L1-T1"] = { id: "L1-T1", lane: "L1", kind: "code", mode: "lane", title: "Empty cart message", goal: "show the empty cart message", acceptance: ["empty cart renders it"], owned: ["src/cart/**"], outOfScope: ["checkout"], peer: "peer-1", status: "working", openedAt: 1, updatedAt: 1, silent: 0 } as never;
  ledger.agents["peer-1"] = { id: "peer-1", role: "peer", lane: "L1", task: "L1-T1" };
  mkdirSync(project.state, { recursive: true });
  saveLedger(project.state, ledger);
  await notice(services, project, { id: "peer-1", provider: "sw2-peer-claude/claude-opus-5" }, [stuck]);
  await notice(services, project, { id: "peer-2", provider: "sw2-peer-claude/claude-opus-5" }, [stuck]);
  const listed = (await incidents.handle(services, supervisor, {})).text;
  assert.match(listed, /What they were asked:\n- L1-T1 Empty cart message: goal show the empty cart message; acceptance empty cart renders it; owned src\/cart\/\*\*; out of scope checkout/);
});

test("a kind most of whose last ten marks were noise is held on probation, a page never is, and marks that turn it round let it go again", async () => {
  const { project, services, seated, supervisor } = desk(true);
  seated.supervisor = "sup";
  const seat = (n: number) => ({ id: `peer-${n}`, title: "Peer", provider: "sw2-peer-claude/claude-opus-5" });
  const marks = (useful: number, count = 10, unknown = 0) => {
    mkdirSync(project.state, { recursive: true });
    const marked = (kind: string, level: string, n: number) => ({ id: `I${kind}${n}`, seat: `old-${n}`, where: "old", kind, level, quote: `q${n}`, facts: [kind], opened: n, last: n, count: 1, open: false, told: n, label: n >= count ? "unknown" : n < useful ? "useful" : "noise", closed: 1000 + n });
    const items = Array.from({ length: count + unknown }, (_, n) => [marked("stuck", "attend", n), marked("destructive", "page", n)]).flat();
    writeFileSync(join(project.state, "incidents.json"), JSON.stringify({ next: 100, items: Object.fromEntries(items.map((item) => [item.id, item])) }));
  };
  marks(4);
  await notice(services, project, seat(1), [stuck]);
  await notice(services, project, seat(2), [{ kind: "destructive", level: "page", quote: "rm -rf /", facts: ["destructive"] }]);
  const held = Object.values(loadIncidents(project.state).items).filter((item) => item.open);
  assert.deepEqual(held.map((item) => [item.kind, item.held ?? null, item.told !== undefined]), [["stuck", "probation", false], ["destructive", null, true]]);
  assert.match((await incidents.handle(services, supervisor, {})).text, /\[attend, not sent: most of its kind's last ten marks were noise\] Peer \(peer-1\)/, "the book says why");

  marks(5, 10, 3);
  await notice(services, project, seat(3), [stuck]);
  assert.ok(Object.values(loadIncidents(project.state).items).find((item) => item.seat === "peer-3")!.told, "half of the last ten useful is not probation, and a mark of unknown says nothing either way");
  marks(0, 9);
  await notice(services, project, seat(4), [stuck]);
  assert.ok(Object.values(loadIncidents(project.state).items).find((item) => item.seat === "peer-4")!.told, "nine marks judge nothing");
});
