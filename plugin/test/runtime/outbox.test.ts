import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { Seats } from "../../server/core/ports.ts";
import { Outbox } from "../../server/runtime/outbox.ts";
import { tempDir } from "../tempdir.ts";

type FakeAgent = {
  status: string;
  pendingPermissions: { title?: string; name?: string }[];
  archivedAt: string | null;
  sent: string[];
  steered: string[];
  kinds: string[][];
};

function fakeSeats(agents: Record<string, FakeAgent>): Pick<Seats, "look" | "send"> {
  return {
    async look(id: string) {
      const agent = agents[id]!;
      return { id, status: agent.status, pendingPermissions: agent.pendingPermissions, archivedAt: agent.archivedAt };
    },
    async send(id: string, text: string, kinds: string[], into?: "steer" | "interrupt") {
      agents[id]!.sent.push(text);
      agents[id]!.kinds.push(kinds);
      if (into === "steer") agents[id]!.steered.push(text);
    },
  };
}

const agent = (status: string, more: Partial<FakeAgent> = {}): FakeAgent => ({
  status,
  pendingPermissions: [],
  archivedAt: null,
  sent: [],
  steered: [],
  kinds: [],
  ...more,
});

test("a letter goes to its seat when the seat can take it, and until then is held and kept, never sent twice and never waking a seat for nothing", async () => {
  const agents = {
    sup: agent("idle"),
    busy: agent("running"),
    asking: agent("idle", { pendingPermissions: [{}] }),
    archived: agent("idle", { archivedAt: "2026-01-01" }),
    real: agent("idle"),
    lead: agent("running"),
    fresh: agent("running"),
    unseen: agent("running"),
    peer: agent("running"),
    stopped: agent("running", { pendingPermissions: [{ title: "Which?" }] }),
    quiet: agent("idle"),
  };
  // Whether a seat's harness takes mail into a running turn is its own: here, by the seat.
  const steering = new Set(["lead", "fresh", "unseen", "stopped"]);
  const outbox = new Outbox(
    join(tempDir(), "outbox.json"),
    (_to, list) => list.map((letter) => letter.text).join("|"),
    fakeSeats(agents),
    { steers: (seat) => steering.has(seat.id) },
  );
  const post = (to: string, key: string, text: string, wakes?: false) =>
    outbox.post({ to, key, text, ...(wakes === false ? { wakes } : {}) });

  assert.equal(await post("sup", "k1", "one"), "sent", "an idle seat is sent a letter at once");
  assert.deepEqual(agents.sup.sent, ["one"]);
  assert.equal(await post("sup", "k1", "one"), "duplicate");
  assert.equal(await post("sup", "b", "second"), "held", "after sending, a seat is left alone until its turn ends");
  outbox.turnEnded("sup");
  await outbox.pump("sup");
  assert.deepEqual(agents.sup.sent, ["one", "second"]);

  for (const [key, text] of [
    ["rework:L1-T1:1", "first"],
    ["amended:L1-T1:1", "second"],
    ["rework:L1-T1:2", "third"],
  ] as const)
    assert.equal(await post("busy", key, text), "held", "a busy seat's letters wait");
  agents.busy.status = "idle";
  outbox.turnEnded("busy");
  assert.equal((await outbox.pump("busy")).size, 3);
  assert.deepEqual(agents.busy.sent, ["first|second|third"], "and go out together when its turn ends");
  assert.deepEqual(agents.busy.kinds, [["rework", "amended"]], "each kind of letter in it named once");
  assert.deepEqual(outbox.pending("busy"), []);

  assert.equal(await post("asking", "x", "t"), "held", "a seat with a pending permission receives nothing");
  assert.equal(await post("archived", "y", "t"), "held", "nor does an archived one");
  assert.deepEqual([outbox.pending("asking").length, outbox.pending("archived").length], [1, 1], "neither's is lost");
  assert.equal(await post("gone", "x", "a report nobody can read yet"), "held", "an address is no failure");
  assert.equal(outbox.pending("gone").length, 1);
  assert.equal(await post("real", "y", "and this still goes out"), "sent");
  assert.deepEqual(agents.real.sent, ["and this still goes out"]);

  outbox.turnStarted("lead", Date.now() - 2 * 60_000);
  assert.equal(await post("lead", "a", "the owner says stop"), "sent");
  assert.deepEqual(agents.lead.steered, ["the owner says stop"], "into a settled turn, not in place of it");
  // A steer the provider cannot take yet is turned into replacing the turn by the daemon.
  outbox.turnStarted("fresh");
  assert.equal(await post("fresh", "a", "t"), "held");
  // Nor one the desk never saw start, which may have begun a moment ago.
  assert.equal(await post("unseen", "a", "t"), "held");
  outbox.turnStarted("peer", Date.now() - 2 * 60_000);
  assert.equal(await post("peer", "a", "t"), "held", "a harness that cannot take mail mid-turn waits");
  outbox.turnStarted("stopped", Date.now() - 2 * 60_000);
  assert.equal(await post("stopped", "a", "t"), "held", "stopped until the permission is decided");
  assert.deepEqual(
    [agents.fresh, agents.unseen, agents.peer, agents.stopped].flatMap((seat) => seat.sent),
    [],
  );

  assert.equal(await post("quiet", "opened:L2", "lane opened", false), "held", "word that asks nothing waits");
  outbox.turnEnded("quiet");
  assert.equal((await outbox.pump("quiet")).size, 0, "a round does not send it on its own either");
  assert.deepEqual(agents.quiet.sent, []);
  assert.equal(await post("quiet", "ask:A1", "a question"), "sent");
  assert.deepEqual(agents.quiet.sent, ["lane opened|a question"], "it goes with the next letter that asks");
});
