import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { PaseoApi } from "../../server/core/paseo.ts";
import { Outbox } from "../../server/runtime/outbox.ts";
import { tempDir } from "../../server/core/testing.ts";

type FakeAgent = { status: string; pendingPermissions: unknown[]; archivedAt: string | null; sent: string[] };

function fakePaseo(agents: Record<string, FakeAgent>): PaseoApi {
  return {
    agents: {
      ref(id: string) {
        const agent = agents[id]!;
        return {
          async refresh() {},
          get status() {
            return agent.status;
          },
          get pendingPermissions() {
            return agent.pendingPermissions;
          },
          get archivedAt() {
            return agent.archivedAt;
          },
          current() {
            return { provider: "sw2-lead", cwd: "/repo" };
          },
          async send(text: string) {
            agent.sent.push(text);
          },
        };
      },
    },
  } as unknown as PaseoApi;
}

const agent = (status: string): FakeAgent => ({ status, pendingPermissions: [], archivedAt: null, sent: [] });

test("a letter to an idle seat is sent at once and the same key is not sent twice", async () => {
  const agents = { sup: agent("idle") };
  const outbox = new Outbox(join(tempDir(), "outbox.json"), (_to, list) => list.map((letter) => letter.text).join("|"));
  const paseo = fakePaseo(agents);
  assert.equal(await outbox.post(paseo, { to: "sup", key: "k1", text: "one" }), "sent");
  assert.deepEqual(agents.sup.sent, ["one"]);
  assert.equal(await outbox.post(paseo, { to: "sup", key: "k1", text: "one" }), "duplicate");
});

test("letters to a busy seat are held and go out together when its turn ends", async () => {
  const agents = { sup: agent("running") };
  const outbox = new Outbox(join(tempDir(), "outbox.json"), (_to, list) => list.map((letter) => letter.text).join("|"));
  const paseo = fakePaseo(agents);
  assert.equal(await outbox.post(paseo, { to: "sup", key: "a", text: "first" }), "held");
  assert.equal(await outbox.post(paseo, { to: "sup", key: "b", text: "second" }), "held");
  agents.sup.status = "idle";
  outbox.turnEnded("sup");
  const sent = await outbox.pump(paseo, "sup");
  assert.equal(sent.size, 2);
  assert.deepEqual(agents.sup.sent, ["first|second"]);
  assert.deepEqual(outbox.pending("sup"), []);
});

test("after sending, a seat is left alone until its turn ends", async () => {
  const agents = { sup: agent("idle") };
  const outbox = new Outbox(join(tempDir(), "outbox.json"), (_to, list) => list.map((letter) => letter.text).join("|"));
  const paseo = fakePaseo(agents);
  await outbox.post(paseo, { to: "sup", key: "a", text: "first" });
  assert.equal(await outbox.post(paseo, { to: "sup", key: "b", text: "second" }), "held");
  outbox.turnEnded("sup");
  await outbox.pump(paseo, "sup");
  assert.deepEqual(agents.sup.sent, ["first", "second"]);
});

test("a seat with a pending permission or an archived seat receives nothing", async () => {
  const agents = { a: { ...agent("idle"), pendingPermissions: [{}] }, b: { ...agent("idle"), archivedAt: "2026-01-01" } };
  const outbox = new Outbox(join(tempDir(), "outbox.json"), (_to, list) => list[0]!.text);
  const paseo = fakePaseo(agents);
  assert.equal(await outbox.post(paseo, { to: "a", key: "x", text: "t" }), "held");
  assert.equal(await outbox.post(paseo, { to: "b", key: "y", text: "t" }), "held");
  assert.deepEqual(outbox.pending("b"), []);
});
