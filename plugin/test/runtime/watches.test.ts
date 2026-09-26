import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";
import type { Seats, SeatView } from "../../server/core/ports.ts";
import { follow } from "../../server/core/stream.ts";
import { SeatWatch, Watches } from "../../server/runtime/watch/watches.ts";
import { FakeTimeline, settle } from "./fake-timeline.ts";
import { laneWithPeer } from "./harness.ts";

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

const seat = (id: string, provider: string): SeatView => ({
  id,
  provider,
  cwd: "/tmp/p",
  status: "running",
  updatedAt: new Date().toISOString(),
});

test("a seat created while the round sweeps is followed once, and only the roles that are watched", () => {
  const timelines = new Map<string, FakeTimeline>();
  const watches = new Watches({
    kit,
    seats: seatsWith(timelines),
    context: () => undefined,
    found: () => {},
    spoke: () => {},
    log: () => {},
  });
  const peer = seat("p1", "sw2-peer-claude/claude-opus-5");
  watches.follow(peer);
  watches.sync([
    peer,
    seat("s1", "sw2-supervisor-claude/claude-opus-5"),
    seat("r1", "sw2-reviewer-claude/claude-opus-5"),
    seat("l1", "sw2-lead-claude/claude-opus-5"),
  ]);
  watches.follow(peer);
  assert.equal(timelines.get("p1")!.subscriptions, 1);
  assert.deepEqual(
    [...timelines.keys()].sort(),
    ["l1", "p1"],
    "Leads and Peers are watched; a Supervisor and a Reviewer are not",
  );
});

test("a seat archived while it is being joined leaves no subscription behind, and is followed again if it comes back", async () => {
  const timelines = new Map<string, FakeTimeline>();
  let open: () => void = () => {};
  const slow = new FakeTimeline();
  slow.ready = new Promise((resolve) => (open = resolve));
  timelines.set("p1", slow);
  const watches = new Watches({
    kit,
    seats: seatsWith(timelines),
    context: () => undefined,
    found: () => {},
    spoke: () => {},
    log: () => {},
  });
  watches.follow(seat("p1", "sw2-peer-claude/claude-opus-5"));
  watches.drop("p1");
  open();
  await settle();
  assert.equal(slow.listeners.size, 0);
  assert.equal(watches.get("p1") !== undefined, false);
  watches.sync([seat("p1", "sw2-peer-claude/claude-opus-5")]);
  assert.equal(watches.get("p1") !== undefined, true);
});

test("a seat the round no longer sees is let go, and one that failed to join is tried again next round", async () => {
  const timelines = new Map<string, FakeTimeline>();
  const broken = new FakeTimeline();
  broken.refetch = async () => ({ epoch: "e", entries: [], error: "no such agent" });
  timelines.set("p2", broken);
  const watches = new Watches({
    kit,
    seats: seatsWith(timelines),
    context: () => undefined,
    found: () => {},
    spoke: () => {},
    log: () => {},
  });
  watches.sync([seat("p1", "sw2-peer-claude/claude-opus-5"), seat("p2", "sw2-peer-claude/claude-opus-5")]);
  await settle();
  assert.equal(watches.get("p2") !== undefined, false, "a join that failed is not held as followed");
  watches.sync([seat("p2", "sw2-peer-claude/claude-opus-5")]);
  assert.equal(watches.get("p1") !== undefined, false);
  assert.equal(timelines.get("p1")!.listeners.size, 0);
  assert.equal(broken.subscriptions, 2);
});

test("a seat whose stream failed is followed again the next round", async () => {
  const timelines = new Map<string, FakeTimeline>();
  const watches = new Watches({
    kit,
    seats: seatsWith(timelines),
    context: () => undefined,
    found: () => {},
    spoke: () => {},
    log: () => {},
  });
  const peer = seat("p1", "sw2-peer-claude/claude-opus-5");
  watches.sync([peer]);
  await settle();
  timelines.get("p1")!.fail("socket closed");
  await settle();
  assert.equal(watches.get("p1"), undefined, "a stream Paseo released is not held as followed");
  watches.sync([peer]);
  assert.equal(timelines.get("p1")!.subscriptions, 2);
});

test("what a seat is watched against is read again until the ledger has placed it", () => {
  // A Peer's first turn starts before start_task places it, so an empty first read must not be kept.
  let placed = false;
  const rules = {
    destructive: /x^/,
    testPath: /x^/,
    suppressed: /x^/,
    skipped: /x^/g,
    assertion: /x^/g,
    runners: new Set<string>(),
    gates: [],
    cwd: "/work",
    repeatsAt: 3,
    recoverWithin: 10,
  };
  const watch = new SeatWatch({ id: "p1", provider: "sw2-peer-claude", cwd: "/work" }, () => ({
    rules: { ...rules, scope: placed ? ["src/a.ts"] : undefined },
    handedBack: () => undefined,
    placed,
  }));
  assert.equal(watch.placed()?.rules.scope, undefined);
  placed = true;
  assert.deepEqual(watch.placed()?.rules.scope, ["src/a.ts"]);
});

test("a refusal from the desk reaches no one as a failed call, while a command that failed does", async () => {
  const { h, timeline } = await laneWithPeer({ attention: { watch: true } });
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  // A refused hand-back, as a Peer's call to the team server records it.
  const refusal =
    'MCP tool \'done\' returned an error: [\n  {\n    "type": "text",\n    "text": "This task is already merged; there is nothing to hand back."\n  }\n]';
  timeline.add(
    {
      type: "tool_call",
      callId: "r1",
      name: "mcp__team__done",
      status: "failed",
      detail: { type: "plain_text", label: "done", text: refusal },
      error: { message: "Tool call failed" },
    },
    "t1",
  );
  timeline.add(
    {
      type: "tool_call",
      callId: "c1",
      name: "Bash",
      status: "failed",
      detail: { type: "shell", command: "cat ./missing.txt", output: "" },
    },
    "t1",
  );
  await settle();
  const facts = h.events("watch.fact");
  assert.deepEqual(
    facts.map((event) => [event.fact, event.quote]),
    [["call-failed", "Bash: cat ./missing.txt"]],
  );
});
