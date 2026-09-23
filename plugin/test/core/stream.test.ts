import assert from "node:assert/strict";
import { test } from "node:test";
import type { Seen } from "../../server/core/ports.ts";
import { follow } from "../../server/core/stream.ts";
import { FakeTimeline, settle } from "../runtime/fake-timeline.ts";

const call = (callId: string, status: string, command?: string) => ({ type: "tool_call", callId, name: "Bash", status, detail: command ? { type: "shell", command } : { type: "unknown" } });

function watching(timeline: FakeTimeline) {
  const seen: Seen[] = [];
  const stream = follow(timeline, (entry) => seen.push(entry), { log: () => {} });
  const rows = () => seen.flatMap((entry) => (entry.kind === "row" ? [{ seq: entry.row.seq, replay: entry.row.replay, epoch: entry.row.epoch }] : []));
  return { seen, stream, rows };
}

test("a seat joined mid-turn is told what it already did as replay, and what it does from the moment of joining as live, each row once", async () => {
  const timeline = new FakeTimeline();
  timeline.add({ type: "user_message", text: "go" });
  timeline.add(call("c1", "running", "sleep 4"));
  const { stream, rows } = watching(timeline);
  timeline.add(call("c1", "completed", "sleep 4"));
  await stream.ready;
  timeline.add({ type: "assistant_message", text: "done" });
  await settle();
  assert.deepEqual(rows(), [
    { seq: 1, replay: true, epoch: "epoch-1" },
    { seq: 2, replay: true, epoch: "epoch-1" },
    { seq: 3, replay: false, epoch: "epoch-1" },
    { seq: 4, replay: false, epoch: "epoch-1" },
  ], "a row that happened while the stream was being joined is live, not history");
});

test("rows sent while the client was not listening are read back from where the sequence broke, in order", async () => {
  const timeline = new FakeTimeline();
  const { stream, rows } = watching(timeline);
  await stream.ready;
  timeline.add(call("c1", "running", "a"));
  timeline.add(call("c1", "completed", "a"), "turn-1", true);
  timeline.add(call("c2", "running", "b"), "turn-1", true);
  timeline.add(call("c2", "completed", "b"));
  await settle();
  assert.deepEqual(rows().map((row) => row.seq), [1, 2, 3, 4]);
  assert.deepEqual(rows().map((row) => row.replay), [false, false, false, false], "what was missed happened just now, not in history");
  assert.deepEqual(timeline.fetches.at(-1), { direction: "after", from: 1 });
});

test("a rewind voids what was seen and tells the rewound timeline again as replay", async () => {
  const timeline = new FakeTimeline();
  const { seen, stream, rows } = watching(timeline);
  await stream.ready;
  timeline.add({ type: "user_message", text: "one" });
  timeline.add({ type: "user_message", text: "two" });
  await settle();
  timeline.rewind(1);
  await settle();
  const reset = seen.findIndex((entry) => entry.kind === "reset");
  assert.ok(reset > 0, "the rewind is told as a reset");
  assert.deepEqual(rows().slice(-1), [{ seq: 1, replay: true, epoch: "epoch-2" }]);
  timeline.add({ type: "assistant_message", text: "after" });
  await settle();
  assert.deepEqual(rows().slice(-1), [{ seq: 2, replay: false, epoch: "epoch-2" }]);
});

test("history a reload sends again is replay, and what the seat does in the meantime is not, in whatever order they arrive", async () => {
  const timeline = new FakeTimeline();
  const { seen, stream, rows } = watching(timeline);
  await stream.ready;
  timeline.add({ type: "user_message", text: "go" });
  timeline.add(call("c1", "completed", "rm -rf build"));
  await settle();
  timeline.epoch = "epoch-2";
  const history = timeline.rows;
  timeline.rows = [];
  timeline.beat("turn_started", "turn-2");
  timeline.add({ type: "user_message", text: "again" }, "turn-2");
  for (const row of history) timeline.add(row.item, null);
  timeline.add(call("c2", "running", "ls"), "turn-2");
  await settle();
  assert.equal(seen.filter((entry) => entry.kind === "reset").length, 1);
  assert.deepEqual(rows().slice(2), [
    { seq: 1, replay: false, epoch: "epoch-2" },
    { seq: 2, replay: true, epoch: "epoch-2" },
    { seq: 3, replay: true, epoch: "epoch-2" },
    { seq: 4, replay: false, epoch: "epoch-2" },
  ]);
});

test("a seat already mid-turn when it is joined is told the turn it is in, from when it started", async () => {
  const timeline = new FakeTimeline();
  timeline.add({ type: "user_message", text: "go" });
  const started = Date.parse("2026-09-19T10:00:00.000Z");
  const refetch = timeline.refetch.bind(timeline);
  timeline.refetch = async (options) => ({ ...(await refetch(options)), agent: { activeTurn: { turnId: "turn-1", startedAt: new Date(started).toISOString() } } });
  const { seen, stream } = watching(timeline);
  await stream.ready;
  assert.deepEqual(seen.find((entry) => entry.kind === "turn"), { kind: "turn", phase: "started", turnId: "turn-1", at: started });
});

test("a seat reloaded while nobody listened is read again from its tail rather than told as a gap", async () => {
  const timeline = new FakeTimeline();
  const { seen, stream, rows } = watching(timeline);
  await stream.ready;
  timeline.add({ type: "user_message", text: "go" });
  await settle();
  timeline.epoch = "epoch-9";
  timeline.rows = [{ item: { type: "user_message", text: "go" }, seq: 1, turnId: "turn-1" }];
  timeline.add({ type: "assistant_message", text: "hi" });
  await settle();
  assert.equal(seen.filter((entry) => entry.kind === "reset").length, 1);
  assert.deepEqual(rows().slice(1), [
    { seq: 1, replay: true, epoch: "epoch-9" },
    { seq: 2, replay: true, epoch: "epoch-9" },
  ]);
});

test("turn beats pass through, and the plugin's own items are not the seat's doing", async () => {
  const timeline = new FakeTimeline();
  const { seen, stream } = watching(timeline);
  await stream.ready;
  timeline.beat("turn_started");
  timeline.add({ type: "plugin", pluginId: "paseo-crew", text: "note" });
  timeline.add({ type: "assistant_message", text: "x" });
  timeline.beat("turn_failed", "turn-1", "boom");
  await settle();
  assert.deepEqual(
    seen.map((entry) => (entry.kind === "row" ? `row ${entry.row.seq}` : entry.kind === "turn" ? `turn ${entry.phase}${entry.error ? ` ${entry.error}` : ""}` : entry.kind)),
    ["turn started", "row 2", "turn failed boom"],
  );
});

test("a join that never becomes ready is given up and leaves nothing subscribed", async () => {
  const timeline = new FakeTimeline();
  timeline.ready = new Promise(() => {});
  const stream = follow(timeline, () => {}, { readyMs: 20, log: () => {} });
  await assert.rejects(stream.ready, /took longer than 20 ms/);
  assert.equal(timeline.listeners.size, 0);
});

// Paseo resumes an archived agent to serve history and never closes it; for Devin that left `devin acp` running for hours.
test("a stream stopped while a message is on its way reads no more history for it", async () => {
  const timeline = new FakeTimeline();
  const { stream } = watching(timeline);
  await stream.ready;
  const before = timeline.fetches.length;
  timeline.rewind(0);
  stream.stop();
  await settle();
  assert.equal(timeline.fetches.length, before);
});

test("a seat archived by anyone, its parent's archive included, is not read again: the stream stops instead", async () => {
  const timeline = new FakeTimeline();
  let archived = false;
  const seen: Seen[] = [];
  const stream = follow(timeline, (entry) => seen.push(entry), { log: () => {}, archived: async () => archived });
  await stream.ready;
  const before = timeline.fetches.length;
  archived = true;
  timeline.rewind(0);
  await settle();
  assert.equal(timeline.fetches.length, before, "no history is asked of an archived agent");
  timeline.add({ type: "assistant_message", text: "late" });
  await settle();
  assert.equal(seen.filter((entry) => entry.kind === "row").length, 0, "and nothing more is told once it has stopped");
});
