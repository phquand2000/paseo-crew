import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";
import type { Seats, SeatView } from "../../server/core/ports.ts";
import { follow } from "../../server/core/stream.ts";
import { Watches } from "../../server/runtime/watch/watches.ts";
import { FakeTimeline, settle } from "./fake-timeline.ts";

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

function seatsWith(timelines: Map<string, FakeTimeline>): Seats {
  return {
    watch: (id, see) => {
      const timeline = timelines.get(id) ?? new FakeTimeline();
      timelines.set(id, timeline);
      return follow(timeline, see, { log: () => {} });
    },
  } as Seats;
}

const seat = (id: string, provider: string): SeatView => ({ id, provider, cwd: "/tmp/p", status: "running", updatedAt: new Date().toISOString() });

test("a seat created while the round sweeps is followed once, and only the roles that are watched", () => {
  const timelines = new Map<string, FakeTimeline>();
  const watches = new Watches({ kit, seats: seatsWith(timelines), log: () => {} });
  const peer = seat("p1", "sw2-peer-devin/swe-2-max");
  watches.follow(peer);
  watches.sync([peer, seat("s1", "sw2-supervisor-claude/claude-opus-5"), seat("r1", "sw2-reviewer-claude/claude-opus-5"), seat("l1", "sw2-lead-claude/claude-opus-5")]);
  watches.follow(peer);
  assert.equal(timelines.get("p1")!.subscriptions, 1);
  assert.deepEqual([...timelines.keys()].sort(), ["l1", "p1"], "Leads and Peers are watched; a Supervisor and a Reviewer are not");
});

test("a seat archived while it is being joined leaves no subscription behind, and is followed again if it comes back", async () => {
  const timelines = new Map<string, FakeTimeline>();
  let open: () => void = () => {};
  const slow = new FakeTimeline();
  slow.ready = new Promise((resolve) => (open = resolve));
  timelines.set("p1", slow);
  const watches = new Watches({ kit, seats: seatsWith(timelines), log: () => {} });
  watches.follow(seat("p1", "sw2-peer-devin/swe-2-max"));
  watches.drop("p1");
  open();
  await settle();
  assert.equal(slow.listeners.size, 0);
  assert.equal(watches.has("p1"), false);
  watches.sync([seat("p1", "sw2-peer-devin/swe-2-max")]);
  assert.equal(watches.has("p1"), true);
});

test("a seat the round no longer sees is let go, and one that failed to join is tried again next round", async () => {
  const timelines = new Map<string, FakeTimeline>();
  const broken = new FakeTimeline();
  broken.refetch = async () => ({ epoch: "e", entries: [], error: "no such agent" });
  timelines.set("p2", broken);
  const watches = new Watches({ kit, seats: seatsWith(timelines), log: () => {} });
  watches.sync([seat("p1", "sw2-peer-devin/swe-2-max"), seat("p2", "sw2-peer-devin/swe-2-max")]);
  await settle();
  assert.equal(watches.has("p2"), false, "a join that failed is not held as followed");
  watches.sync([seat("p2", "sw2-peer-devin/swe-2-max")]);
  assert.equal(watches.has("p1"), false);
  assert.equal(timelines.get("p1")!.listeners.size, 0);
  assert.equal(broken.subscriptions, 2);
});
