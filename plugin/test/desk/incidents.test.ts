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
import { closeIncidentsOf, notice, retell } from "../../server/desk/notice.ts";
import type { DeskServices } from "../../server/desk/services.ts";
import { ack, incidents } from "../../server/desk/tools/incidents.ts";
import { decide } from "../../server/runtime/watch/rules.ts";

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const questions = Object.values(kit.sensors)[0]!.questions;

function desk(watching = false) {
  const root = tempDir("sw2-incidents-");
  const project = { root, slug: "p", state: join(root, "state") };
  const posted: { to: string; key: string; text: string }[] = [];
  const seated = { supervisor: undefined as string | undefined };
  const ctx = new DeskContext({
    kit,
    outbox: { post: async (letter) => (posted.push(letter), "sent") },
    log: () => {},
    teamFor: () => resolveTeam(kit, watching ? { attention: { watch: true } } : {}),
    indexesFor: () => [],
  });
  const roster = { supervisorFor: async () => seated.supervisor };
  const services = { ctx, roster } as unknown as DeskServices;
  const supervisor = { id: "sup", role: kit.roles.find((role) => role.role === "supervisor")!, title: "sup", project };
  return { project, services, supervisor, posted, seated };
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
  const reply = await ack(services, supervisor, { id: "I2", verdict: "noise", note: "a normal retry" });
  assert.equal(reply.ok, true, reply.text);
  const held = loadIncidents(project.state).items;
  assert.equal(held.I2!.label, "noise");
  assert.equal(held.I2!.open, false);
  assert.equal(held.I1!.label, undefined, "the other incident is untouched");
  assert.equal(held.I1!.open, true);
  const reopened = await notice(services, project, { id: "peer-2", provider: "sw2-peer-devin/swe-2-max" }, [stuck]);
  assert.deepEqual(reopened.opened.map((incident) => incident.id), ["I3"]);
  const listed = await incidents(services, supervisor, {});
  assert.match(listed.text, /2 not yet marked:/);
  assert.match(listed.text, /I3 \[attend/);
});

test("Jev alone raises only what its questions may raise alone; the rest need a fact that agrees", () => {
  const noted = [{ kind: "outside-scope", level: "note" as const, quote: "/etc/hosts" }];
  const answers = Object.fromEntries(Object.keys(questions).map((name) => [name, 0.99]));
  answers.meaningful_progress = 0.95;
  const found = decide([], { answers, model: "typesafe/jev-1.13-20260917" }, questions, noted);
  assert.deepEqual(found.map((finding) => finding.kind), ["unsafe_action", "needs_human", "work_off_track", "goal_drift", "injected_intent"]);
  assert.equal(found[0]!.level, "page", "what is irreversible goes first");
  assert.deepEqual(found.find((finding) => finding.kind === "goal_drift")!.facts, ["outside-scope"]);
  const stalled = decide([], { answers: { ...answers, meaningful_progress: 0.1 }, model: "m" }, questions, [{ kind: "no-recovery", level: "attend", quote: "q" }]);
  assert.ok(stalled.some((finding) => finding.kind === "meaningful_progress"), "progress is a question answered low, not high");
  assert.deepEqual(decide([{ kind: "call-failed", level: "note", quote: "x" }]), [], "a note is evidence for Jev, not an incident on its own");
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
