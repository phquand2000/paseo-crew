import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type FakeAgent, fakeAgent, fakePaseo, fakeServer } from "./fakes.ts";
import { wire } from "./features/index.ts";
import type { Kit } from "./kit.ts";
import { Runtime } from "./runtime.ts";

const kit: Kit = {
  seats: [
    { role: "supervisor", harness: "claude", entry: true, mayStart: ["lead"] },
    { role: "lead", harness: "claude", mayStart: ["peer", "reviewer"] },
    { role: "peer", harness: "omp" },
    { role: "reviewer", harness: "omp" },
  ],
  profiles: [{ provider: "reviewer", model: "zai/glm-5.3" }],
  providers: { reviewer: { models: [{ id: "zai/glm-5.3" }] } },
  harnesses: {},
};

function project() {
  const root = mkdtempSync(join(tmpdir(), "seatworks-wiring-"));
  mkdirSync(join(root, ".seatworks"));
  const lines: string[] = [];
  const outbox = join(root, "outbox.json");
  const start = () => {
    const runtime = new Runtime({ kit: () => kit, log: (_, line) => lines.push(line), outbox });
    const fake = fakeServer();
    wire(fake.server, runtime);
    return fake;
  };
  return { root, lines, start };
}

const hookAgent = (agent: FakeAgent, parentAgentId: string | null = null) => ({
  id: agent.id,
  workspaceId: null,
  parentAgentId,
  provider: agent.provider,
  cwd: agent.cwd,
  title: null,
});
const turnEnded = (agent: FakeAgent, text: string) => ({
  agent: hookAgent(agent),
  turnId: "t1",
  outcome: { kind: "completed" },
  timeline: [{ type: "assistant_message", text }],
});
test("a launch with a model the seat does not offer fails before the agent exists", () => {
  const { root, start } = project();
  const { request } = start();
  const { paseo } = fakePaseo([]);
  assert.throws(
    () => request("agent.create", { config: { provider: "reviewer", cwd: root, model: "claude-opus-5" } }, paseo),
    /runs zai\/glm-5\.3/,
  );
});

test("a bad project setting is logged once, and the launch still goes ahead on defaults", () => {
  const { root, lines, start } = project();
  writeFileSync(join(root, ".seatworks", "project.json"), JSON.stringify({ attention: { sweepMinutes: -1 } }));
  const { request } = start();
  const { paseo } = fakePaseo([]);
  for (let launch = 0; launch < 2; launch++) {
    request("agent.create", { config: { provider: "reviewer", cwd: root } }, paseo);
  }
  assert.deepEqual(lines, [".seatworks/project.json  attention.sweepMinutes must be a whole number of at least 1; using 10"]);
});

test("an agent a parent may not start is archived and the parent is told", async () => {
  const { root, start } = project();
  const { emit } = start();
  const peer = fakeAgent("p1", "peer/zai/glm-5.3-flash", root);
  const { paseo, sent, archived } = fakePaseo([peer]);
  await emit("agent.created", { agent: hookAgent(fakeAgent("r1", "reviewer", root), "p1") }, paseo);
  assert.deepEqual(archived, ["r1"]);
  assert.match(sent[0]?.text ?? "", /^Agent r1 \(reviewer\) was archived as soon as it started: a peer starts no agents/);
});

test("events reach an idle Supervisor as one message, and a later one waits for its turn to end", async () => {
  const { root, lines, start } = project();
  const { emit } = start();
  const supervisor = fakeAgent("s1", "supervisor", root);
  const [p1, p2, p3] = [fakeAgent("p1", "peer", root), fakeAgent("p2", "peer", root), fakeAgent("p3", "peer", root)];
  const { paseo, sent } = fakePaseo([supervisor, p1, p2, p3]);
  await Promise.all([
    emit("agent.turn_ended", turnEnded(p1, "DECISION: store cents"), paseo),
    emit("agent.turn_ended", turnEnded(p2, "DECISION: keep floats"), paseo),
  ]);
  assert.equal(sent.length, 1);
  assert.match(sent[0]?.text ?? "", /DECISION: store cents/);
  assert.match(sent[0]?.text ?? "", /DECISION: keep floats/);
  await emit("agent.turn_ended", turnEnded(p3, "DECISION: add a ledger"), paseo);
  assert.equal(sent.length, 1);
  assert.ok(lines.includes('p3 (peer)  decision  "DECISION: add a ledger"  -> held'));
  await emit("agent.turn_ended", turnEnded(supervisor, "noted"), paseo);
  assert.equal(sent.length, 2);
  assert.match(sent[1]?.text ?? "", /DECISION: add a ledger/);
});

test("an event held while the Supervisor waits on a permission survives a restart and goes out when its turn ends", async () => {
  const { root, lines, start } = project();
  const supervisor = fakeAgent("s1", "supervisor", root, { pendingPermissions: [{ id: "own" }] });
  const peer = fakeAgent("p1", "peer", root);
  const { paseo, sent } = fakePaseo([supervisor, peer]);
  await start().emit("agent.turn_ended", turnEnded(peer, "DECISION: store cents"), paseo);
  assert.equal(sent.length, 0);
  assert.ok(lines.includes('p1 (peer)  decision  "DECISION: store cents"  -> held'));
  const restarted = start();
  supervisor.pendingPermissions = [];
  await restarted.emit("agent.turn_ended", turnEnded(supervisor, "done"), paseo);
  assert.equal(sent.length, 1);
  assert.match(sent[0]?.text ?? "", /^ATTENTION: decision in p1 \(peer\)/);
});

test("a held notice for an agent that is archived is dropped", async () => {
  const { root, start } = project();
  const { emit } = start();
  const lead = fakeAgent("l1", "lead", root, { status: "running" });
  const { paseo, sent, archived } = fakePaseo([lead]);
  await emit("agent.created", { agent: hookAgent(fakeAgent("s9", "supervisor", root), "l1") }, paseo);
  assert.deepEqual(archived, ["s9"]);
  assert.equal(sent.length, 0);
  lead.archivedAt = new Date().toISOString();
  await emit("agent.archived", { agent: hookAgent(lead), archivedAt: lead.archivedAt }, paseo);
  lead.archivedAt = null;
  lead.status = "idle";
  await emit("agent.turn_ended", turnEnded(lead, "done"), paseo);
  assert.equal(sent.length, 0);
});
