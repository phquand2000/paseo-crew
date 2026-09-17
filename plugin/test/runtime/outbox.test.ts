import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { Seats } from "../../server/core/ports.ts";
import { Outbox } from "../../server/runtime/outbox.ts";
import { tempDir } from "../../server/core/testing.ts";

type FakeAgent = { status: string; pendingPermissions: { title?: string; name?: string }[]; archivedAt: string | null; sent: string[] };

function fakeSeats(agents: Record<string, FakeAgent>): Seats {
  return {
    async open() {
      return [];
    },
    async look(id: string) {
      const agent = agents[id]!;
      return { id, status: agent.status, pendingPermissions: agent.pendingPermissions, archivedAt: agent.archivedAt };
    },
    async send(id: string, text: string) {
      agents[id]!.sent.push(text);
    },
    async archive() {},
  };
}

const agent = (status: string): FakeAgent => ({ status, pendingPermissions: [], archivedAt: null, sent: [] });

const outboxOn = (agents: Record<string, FakeAgent>, compose: (to: string, list: { text: string }[]) => string) =>
  new Outbox(join(tempDir(), "outbox.json"), compose, fakeSeats(agents));

test("a letter to an idle seat is sent at once and the same key is not sent twice", async () => {
  const agents = { sup: agent("idle") };
  const outbox = outboxOn(agents, (_to, list) => list.map((letter) => letter.text).join("|"));
  assert.equal(await outbox.post({ to: "sup", key: "k1", text: "one" }), "sent");
  assert.deepEqual(agents.sup.sent, ["one"]);
  assert.equal(await outbox.post({ to: "sup", key: "k1", text: "one" }), "duplicate");
});

test("letters to a busy seat are held and go out together when its turn ends", async () => {
  const agents = { sup: agent("running") };
  const outbox = outboxOn(agents, (_to, list) => list.map((letter) => letter.text).join("|"));
  assert.equal(await outbox.post({ to: "sup", key: "a", text: "first" }), "held");
  assert.equal(await outbox.post({ to: "sup", key: "b", text: "second" }), "held");
  agents.sup.status = "idle";
  outbox.turnEnded("sup");
  const sent = await outbox.pump("sup");
  assert.equal(sent.size, 2);
  assert.deepEqual(agents.sup.sent, ["first|second"]);
  assert.deepEqual(outbox.pending("sup"), []);
});

test("after sending, a seat is left alone until its turn ends", async () => {
  const agents = { sup: agent("idle") };
  const outbox = outboxOn(agents, (_to, list) => list.map((letter) => letter.text).join("|"));
  await outbox.post({ to: "sup", key: "a", text: "first" });
  assert.equal(await outbox.post({ to: "sup", key: "b", text: "second" }), "held");
  outbox.turnEnded("sup");
  await outbox.pump("sup");
  assert.deepEqual(agents.sup.sent, ["first", "second"]);
});

test("a seat with a pending permission or an archived seat receives nothing", async () => {
  const agents = { a: { ...agent("idle"), pendingPermissions: [{}] }, b: { ...agent("idle"), archivedAt: "2026-01-01" } };
  const outbox = outboxOn(agents, (_to, list) => list[0]!.text);
  assert.equal(await outbox.post({ to: "a", key: "x", text: "t" }), "held");
  assert.equal(await outbox.post({ to: "b", key: "y", text: "t" }), "held");
  assert.deepEqual(outbox.pending("b"), []);
});
