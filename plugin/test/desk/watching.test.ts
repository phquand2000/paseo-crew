import assert from "node:assert/strict";
import { test } from "node:test";
import { type Raised, type Watching, WATCH_RULES, emptyWatching, judge, pending, reported } from "../../server/desk/watching.ts";

const NOW = Date.parse("2026-09-16T12:00:00Z");
const minutes = (count: number) => count * 60_000;

const raised = (over: Partial<Raised> = {}): Raised => ({
  subject: "seat-peer",
  label: "repetition",
  where: "the Peer on L1-T1",
  quote: "went back to src/strings.js three times",
  evidence: [],
  ...over,
});

function run(entries: { raise: Raised; at: number }[]): { watching: Watching; urgencies: string[] } {
  let watching = emptyWatching();
  const urgencies: string[] = [];
  for (const entry of entries) {
    const verdict = judge(watching, entry.raise, entry.at);
    watching = verdict.watching;
    urgencies.push(verdict.urgency);
  }
  return { watching, urgencies };
}

test("with watching switched off, a fault is still recorded and reaches nobody", () => {
  const rules = { ...WATCH_RULES, watch: false };
  const verdict = judge(emptyWatching(), raised({ label: "destructive" }), NOW, rules);
  assert.equal(verdict.urgency, "log", "even the one label that always pages stays quiet when the owner has switched watching off");
  assert.deepEqual(verdict.watching, emptyWatching());
});

test("one suspicious ending waits for the digest rather than interrupting", () => {
  const verdict = judge(emptyWatching(), raised(), NOW);
  assert.equal(verdict.urgency, "digest");
  assert.equal(verdict.strike!.count, 1);
});

test("the same fault from the same seat three times earns the interruption", () => {
  const { urgencies, watching } = run([
    { raise: raised(), at: NOW },
    { raise: raised(), at: NOW + minutes(5) },
    { raise: raised(), at: NOW + minutes(9) },
  ]);
  assert.deepEqual(urgencies, ["digest", "digest", "page"], "evidence accumulates before anyone is woken");
  assert.equal(watching.strikes["seat-peer:repetition"]!.count, 3);
  assert.equal(watching.pages.length, 1);
});

test("different faults from one seat are counted apart", () => {
  const { urgencies } = run([
    { raise: raised({ label: "repetition" }), at: NOW },
    { raise: raised({ label: "unverified" }), at: NOW + minutes(1) },
    { raise: raised({ label: "repetition" }), at: NOW + minutes(2) },
  ]);
  assert.deepEqual(urgencies, ["digest", "digest", "digest"], "two of one fault and one of another is nobody's third strike");
});

test("something that cannot be undone interrupts on its first sighting", () => {
  const verdict = judge(emptyWatching(), raised({ label: "destructive", quote: "git reset --hard origin/main" }), NOW);
  assert.equal(verdict.urgency, "page", "an irreversible act has no second chance to be caught");
  assert.equal(verdict.watching.pages.length, 1);
});

test("the interruption budget holds, and what it refuses still reaches the digest", () => {
  let watching: Watching = { strikes: {}, pages: [NOW - minutes(30), NOW - minutes(10)] };
  const third = judge(watching, raised({ subject: "seat-lead" }), NOW);
  assert.equal(third.urgency, "digest", "two interruptions already spent in this window is the limit");
  watching = third.watching;
  const later = judge(watching, raised({ subject: "seat-lead" }), NOW + minutes(60 * 13));
  assert.equal(later.urgency, "digest");
  const struck = judge(later.watching, raised({ subject: "seat-lead" }), NOW + minutes(60 * 13 + 1));
  assert.equal(struck.urgency, "page", "once the window has rolled past, the budget is whole again");
});

test("the digest holds what was never raised, and empties once it is sent", () => {
  const { watching } = run([
    { raise: raised({ label: "unverified" }), at: NOW },
    { raise: raised({ label: "derailed", subject: "seat-lead" }), at: NOW + minutes(2) },
    { raise: raised({ label: "destructive" }), at: NOW + minutes(3) },
  ]);
  const waiting = pending(watching);
  assert.deepEqual(
    waiting.map((strike) => strike.label),
    ["derailed", "unverified"],
    "what already interrupted the owner is not repeated in the digest",
  );
  assert.deepEqual(pending(reported(watching, NOW + minutes(4))), []);
});
