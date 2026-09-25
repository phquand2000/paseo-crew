import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { projectOf } from "../../server/desk/project.ts";
import { settle } from "./fake-timeline.ts";
import { laneWithPeer, repo } from "./harness.ts";

test("an incident about a Peer whose Lead is gone goes to whoever supervises, and a Lead reads and marks only its own lane's", async () => {
  const { h, sup, lane, peer } = await laneWithPeer({ attention: { watch: true, incidentsPerLane: 3 } });
  const lead = lane.lead!;
  const about = (seat: string, kind: string, level: "attend" | "page" = "attend") =>
    h.runtime.desk.notice(h.project, { id: seat, provider: h.agents.get(seat)!.provider, title: seat }, [{ kind, level, quote: `${kind} seen`, facts: [kind] }]);
  await about(peer, "test-weakened");
  await about(lead, "long-turn");
  await h.idle(lead);
  await h.idle(sup);
  assert.match(h.agents.get(lead)!.sent.join("\n"), /INCIDENT I1 \(test-weakened, attend\)/);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I2 \(long-turn, attend\) on the Lead/, "one about the Lead goes above it");

  const listed = await h.call(lead, "lead", "incidents", {});
  assert.equal(listed.ok, true, listed.text);
  assert.match(listed.text, /I1 \[attend/);
  assert.doesNotMatch(listed.text, /I2/, "never one about itself");
  const own = await h.call(lead, "lead", "mark_incident", { id: "I2", verdict: "noise", note: "expected" });
  assert.equal(own.ok, false, "nor may it mark one");
  assert.match(own.text, /no incident I2 here for you/);
  const marked = await h.call(lead, "lead", "mark_incident", { id: "I1", verdict: "useful", note: "it was going round" });
  assert.equal(marked.ok, true, marked.text);
  assert.match((await h.call(sup, "supervisor", "incidents", { closed: true })).text, /I1 \[attend, closed, told [^\]]*, marked useful\]/, "whoever supervises sees what the Lead marked");

  h.agents.get(lead)!.archivedAt = new Date().toISOString();
  await about(peer, "suppressed");
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I3 \(suppressed, attend\) on the Peer/, "with its Lead gone, it goes above");
});

const incidentsOf = (state: string) => JSON.parse(readFileSync(join(state, "incidents.json"), "utf-8")).items as Record<string, { kind: string; held?: string; told?: number; level: string }>;

test("an irreversible command a Peer starts reaches the Supervisor before the call finishes, and nothing of it reaches the Peer", async () => {
  const { h, sup, peer, timeline } = await laneWithPeer({ attention: { watch: true } });
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "running", detail: { type: "unknown", input: {}, output: null } }, "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "running", detail: { type: "shell", command: "rm -rf build" } }, "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.idle(sup);
  const told = h.agents.get(sup)!.sent.join("\n");
  assert.match(told, /INCIDENT I1 \(destructive, page\) on the Peer on L1-T1 \(Clean build\)/);
  assert.match(told, /What was seen: rm -rf build/);
  assert.match(told, /not a verdict/);
  assert.ok(!timeline.rows.some((row) => row.item.status === "completed"), "the call it warns about is still running");
  assert.deepEqual(h.runtime.outbox.letters().filter((letter) => letter.to === peer), [], "nothing the watch concluded is even queued for the seat it watches");
  await h.idle(peer);
  const watched = h.agents.get(peer)!;
  assert.deepEqual([...watched.sent, ...watched.steered].filter((text) => /INCIDENT|destructive|rm -rf|incident/i.test(text)), [], "nor reaches it when its turn ends");
});

test("a turn that runs long is told to the Peer's Lead", async () => {
  const { h, sup, lane, timeline } = await laneWithPeer({ attention: { watch: true } });
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Make the build pass" }, "t1");
  await settle();
  await h.tick(Date.now() + 31 * 60_000);
  await h.idle(sup);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /INCIDENT I1 \(long-turn, attend\)/, "one about a Peer goes to its Lead");
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I1/);
});

test("two projects each hear about their own seats, though their incidents carry the same number", async () => {
  const { h, sup } = await laneWithPeer({ attention: { watch: true } });
  const second = repo();
  const other = projectOf(second.root);
  mkdirSync(other.state, { recursive: true });
  writeFileSync(join(other.state, "settings.json"), JSON.stringify({ attention: { watch: true } }));
  const supB = h.add("sw2-supervisor-claude/claude-opus-5", second.root, "sup-b");
  const page = [{ kind: "destructive", level: "page" as const, quote: "rm -rf build", facts: ["destructive"] }];
  await h.runtime.desk.notice(h.project, { id: "p-a", provider: "sw2-peer-claude/claude-opus-5" }, page);
  await h.runtime.desk.notice(other, { id: "p-b", provider: "sw2-peer-claude/claude-opus-5" }, page);
  await h.idle(sup);
  await h.idle(supB);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I1 \(destructive, page\)/);
  assert.match(h.agents.get(supB)!.sent.join("\n"), /INCIDENT I1 \(destructive, page\)/, "the second project's owner is told too, not dropped as a repeat of the first");
});

test("a lane's own record is gone through for what no turn shows", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  await h.tick();
  await h.idle(sup);
  const book = JSON.parse(readFileSync(join(h.project.state, "incidents.json"), "utf-8")) as { items: Record<string, { kind: string }> };
  assert.deepEqual(Object.values(book.items).map((item) => item.kind), ["rework-loop"]);
});

test("a task the Lead keeps sending back is an incident about the Lead, raised once and never shown to it", async () => {
  const { h, sup, lane, peer } = await laneWithPeer({ attention: { watch: true } });
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.reworks, 3, "three sendings-back are on the record");

  await h.tick();
  await h.idle(sup);
  const told = h.agents.get(sup)!.sent.join("\n");
  assert.match(told, /INCIDENT I1 \(rework-loop, attend\) on the Lead of L1 \(Build\)/, "the seat it is about is the one that decides to send it back");
  assert.match(told, /What was seen: L1-T1 \(Clean build\) has been sent back 3 times/);

  // Three sendings-back stay three forever, so once marked the unchanged record must not raise again.
  const marked = await h.call(sup, "supervisor", "mark_incident", { id: "I1", verdict: "noise", note: "expected: the brief changed under it" });
  assert.equal(marked.ok, true, marked.text);
  await h.tick();
  await h.tick();
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), ["I1"], "the same three sendings-back are not raised again once they have been marked");

  // A fourth is new evidence, and is raised.
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "round 4" });
  await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "still not" });
  await h.tick();
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), ["I1", "I2"], "a fourth sending-back is something new to say");
});

test("a standing condition held back while the watch is off is still there to tell when it is turned on", async () => {
  // A lane's history never changes on its own, so a condition held while off must be told when turned on.
  const { h, sup, lane, peer } = await laneWithPeer();
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  await h.tick();
  await h.idle(sup);
  assert.deepEqual(Object.values(incidentsOf(h.project.state)).map((item) => [item.kind, item.held]), [["rework-loop", "shadow"]]);
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /INCIDENT/);

  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ attention: { watch: true } }));
  await h.tick();
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I1 \(rework-loop, attend\)/, "the same unchanged record is told once the owner turns it on");
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), ["I1"], "and it is the incident already on the book, not a second one");
});

test("a lane whose Lead has gone raises nothing about it, since nothing would ever close it", async () => {
  const { h, lane, peer } = await laneWithPeer({ attention: { watch: true } });
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  await h.tick();
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), [], "an incident about a seat that has gone is one nobody can close");
});
