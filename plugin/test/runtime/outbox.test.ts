import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Seats } from "../../server/core/ports.ts";
import { Outbox } from "../../server/runtime/mail/outbox.ts";
import { reported } from "../console.ts";
import { tempDir } from "../tempdir.ts";

type FakeAgent = {
  status: string;
  pendingPermissions: { title?: string; name?: string }[];
  archivedAt: string | null;
  sent: string[];
  kinds: string[][];
};

function fakeSeats(agents: Record<string, FakeAgent>): Pick<Seats, "look" | "send"> {
  return {
    async look(id: string) {
      const agent = agents[id]!;
      return {
        id,
        status: agent.status,
        pendingPermissions: agent.pendingPermissions,
        archivedAt: agent.archivedAt,
      };
    },
    async send(id: string, text: string, kinds: string[]) {
      agents[id]!.sent.push(text);
      agents[id]!.kinds.push(kinds);
    },
  };
}

const agent = (status: string, more: Partial<FakeAgent> = {}): FakeAgent => ({
  status,
  pendingPermissions: [],
  archivedAt: null,
  sent: [],
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
    peer: agent("running"),
    stopped: agent("running", { pendingPermissions: [{ title: "Which?" }] }),
    quiet: agent("idle"),
  };
  const file = join(tempDir(), "outbox.json");
  const outbox = new Outbox(file, (_to, list) => list.map((letter) => letter.text).join("|"), fakeSeats(agents));
  const post = (to: string, key: string, text: string, more: { wakes?: false } = {}) =>
    outbox.post({ to, key, text, ...more });

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

  for (const [key, text] of [
    ["done:L1-T1", "L1-T1 handed back"],
    ["message:L1", "the owner says stop"],
  ] as const)
    assert.equal(
      await post("lead", key, text),
      "held",
      "never into a running turn, however long it has run: a Lead cut into while it thinks or writes loses the thought",
    );
  assert.equal(await post("peer", "a", "t"), "held");
  assert.equal(await post("stopped", "a", "t"), "held", "stopped until the permission is decided");
  assert.deepEqual(
    [agents.lead, agents.peer, agents.stopped].flatMap((seat) => seat.sent),
    [],
  );
  agents.lead.status = "idle";
  outbox.turnEnded("lead");
  await outbox.pump("lead");
  assert.deepEqual(
    agents.lead.sent,
    ["L1-T1 handed back|the owner says stop"],
    "its queue goes as one when the turn ends",
  );

  assert.equal(
    await post("quiet", "opened:L2", "lane opened", { wakes: false }),
    "held",
    "word that asks nothing waits",
  );
  outbox.turnEnded("quiet");
  assert.equal((await outbox.pump("quiet")).size, 0, "a round does not send it on its own either");
  assert.deepEqual(agents.quiet.sent, []);
  assert.equal(await post("quiet", "ask:A1", "a question"), "sent");
  assert.deepEqual(agents.quiet.sent, ["lane opened|a question"], "it goes with the next letter that asks");

  writeFileSync(file, "{not json");
  await assert.rejects(post("busy", "late", "held for later"), /outbox\.json is there but could not be read/);
  assert.equal(readFileSync(file, "utf-8"), "{not json", "the letters held in it are not written over by the next one");
});

test("a letter Paseo will not take is kept for the next try, and the post that wrote it does not fail", async (t) => {
  const said = reported(t);
  const agents = { lead: agent("idle") };
  const seats = fakeSeats(agents);
  let refusing = true;
  const outbox = new Outbox(
    join(tempDir(), "outbox.json"),
    (_to, list) => list.map((letter) => letter.text).join("|"),
    {
      look: seats.look,
      async send(id, text, kinds, into) {
        if (refusing) throw new Error("the daemon did not accept the message");
        await seats.send(id, text, kinds, into);
      },
    },
  );
  assert.equal(await outbox.post({ to: "lead", key: "merged:L1-T1", text: "merged" }), "held");
  assert.equal(outbox.pending("lead").length, 1, "what posted it has already done its work, so the letter waits");
  assert.match(said(), /the daemon did not accept the message/);
  refusing = false;
  await outbox.pump("lead");
  assert.deepEqual(agents.lead.sent, ["merged"]);
  assert.deepEqual(outbox.pending("lead"), []);
});

test("held mail rides the reply to a seat's own call, word that asks nothing included, but never past a hold", async () => {
  const agents = {
    sup: agent("running"),
    asking: agent("running", { pendingPermissions: [{}] }),
    held: agent("running"),
    gone: agent("running"),
  };
  const outbox = new Outbox(
    join(tempDir(), "outbox.json"),
    (_to, list) => list.map((letter) => letter.text).join("|"),
    fakeSeats(agents),
    { holding: (seat) => seat.id === "held" },
  );
  await outbox.post({ to: "sup", key: "landed:L1", text: "LANDED L1", wakes: false });
  await outbox.post({ to: "sup", key: "ask:A1", text: "a question" });
  assert.equal(await outbox.take("sup"), "LANDED L1|a question");
  assert.deepEqual(outbox.pending("sup"), [], "taken once: its turn ending sends nothing more");
  assert.equal(await outbox.post({ to: "sup", key: "ask:A1", text: "a question" }), "duplicate");
  assert.equal(await outbox.take("sup"), undefined);
  for (const id of ["asking", "held"]) {
    await outbox.post({ to: id, key: "x", text: "t" });
    assert.equal(await outbox.take(id), undefined, `${id}: kept as the outbox keeps it`);
    assert.equal(outbox.pending(id).length, 1);
  }
  await outbox.post({ to: "gone", key: "x", text: "t" });
  assert.equal(await outbox.take("gone", () => false), undefined, "a reply nobody reads carries none of it");
  assert.equal(outbox.pending("gone").length, 1);
});
