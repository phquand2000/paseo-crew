import assert from "node:assert/strict";
import { test } from "node:test";
import { type Raised, type Watching, WATCH_RULES, delivered, emptyWatching, judge, keyOf, pagesLeft, pending, pendingEntries, reported } from "../../server/desk/watching.ts";

/** What a report built from this state would carry: the keys it holds, at the counts it holds them. */
const carriedBy = (watching: Watching) => Object.fromEntries(pendingEntries(watching).map(([key, strike]) => [key, strike.count]));

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
  assert.equal(verdict.strike?.label, "destructive", "and it is written down, because the report it is promised has to be able to carry it");
  assert.equal(Object.keys(verdict.watching.strikes).length, 1);
  assert.deepEqual(verdict.watching.pages, [], "nothing was spent interrupting anyone");
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
  assert.deepEqual(watching.pages, [], "deciding to interrupt costs nothing; interrupting does");
  const sent = delivered(watching, [keyOf("seat-peer", "repetition")], NOW + minutes(9));
  assert.equal(sent.pages.length, 1);
  assert.deepEqual(pending(sent), [], "and what interrupted the owner is not repeated in the report");
});

test("different faults from one seat are counted apart", () => {
  const { urgencies } = run([
    { raise: raised({ label: "repetition" }), at: NOW },
    { raise: raised({ label: "unverified" }), at: NOW + minutes(1) },
    { raise: raised({ label: "repetition" }), at: NOW + minutes(2) },
  ]);
  assert.deepEqual(urgencies, ["digest", "digest", "digest"], "two of one fault and one of another is nobody's third strike");
});

test("something that cannot be undone interrupts on its first sighting, and keeps waiting if nobody took it", () => {
  const verdict = judge(emptyWatching(), raised({ label: "destructive", quote: "git reset --hard origin/main" }), NOW);
  assert.equal(verdict.urgency, "page", "an irreversible act has no second chance to be caught");
  assert.deepEqual(verdict.watching.pages, []);

  // The one class the desk promises always to escalate. Stamped before delivery, it would be filtered
  // out of the report as already reported, and the report is the only other way it is ever read.
  assert.deepEqual(
    pending(verdict.watching).map((strike) => strike.label),
    ["destructive"],
    "with nobody running to be interrupted, it stays waiting instead of being counted as told",
  );
  assert.deepEqual(pending(delivered(verdict.watching, [keyOf("seat-peer", "destructive")], NOW)), [], "once it has gone somewhere, it is settled");
});

test("the interruption budget holds, and what it refuses still reaches the digest", () => {
  // A fault on its third sighting — the one that earns an interruption — with the window's two pages
  // already spent. The version of this test before started from a first sighting, which answers
  // "digest" on its count alone, so it passed whether or not the budget did anything.
  const spent = [NOW - minutes(30), NOW - minutes(10)];
  let watching: Watching = { strikes: {}, pages: spent };
  for (const at of [NOW - minutes(3), NOW - minutes(2)]) watching = judge(watching, raised({ subject: "seat-lead" }), at).watching;
  const third = judge(watching, raised({ subject: "seat-lead" }), NOW);
  assert.equal(third.strike!.count, 3, "this is the sighting that would interrupt");
  assert.equal(third.urgency, "digest", "and it waits, because two interruptions already spent in this window is the limit");
  assert.deepEqual(pending(third.watching).map((strike) => strike.count), [3], "what the budget refuses is owed to the report");

  // Once the window has rolled past both pages, the same fault interrupts again.
  const rolled = judge(third.watching, raised({ subject: "seat-lead" }), NOW + minutes(60 * 13));
  assert.equal(rolled.urgency, "page", "the budget is whole again");
});

test("the digest holds what was never raised, and empties once it is sent", () => {
  const { watching } = run([
    { raise: raised({ label: "unverified" }), at: NOW },
    { raise: raised({ label: "derailed", subject: "seat-lead" }), at: NOW + minutes(2) },
    { raise: raised({ label: "destructive" }), at: NOW + minutes(3) },
  ]);
  const waiting = pending(delivered(watching, [keyOf("seat-peer", "destructive")], NOW + minutes(3)));
  assert.deepEqual(
    waiting.map((strike) => strike.label),
    ["derailed", "unverified"],
    "what already interrupted the owner is not repeated in the digest",
  );
  assert.deepEqual(pending(reported(watching, carriedBy(watching), NOW + minutes(4))), []);
});

test("every interruption is charged, not only the first one for a fault", () => {
  const key = keyOf("seat-lead", "repetition");
  let watching = emptyWatching();
  for (const at of [NOW, NOW + minutes(1), NOW + minutes(2)]) {
    const verdict = judge(watching, raised({ subject: "seat-lead" }), at);
    watching = verdict.watching;
    if (verdict.urgency === "page") watching = delivered(watching, [key], at);
  }
  assert.equal(watching.pages.length, 1, "three strikes, one interruption");
  assert.equal(pagesLeft(watching, NOW + minutes(2)), 1);

  // The same fault again. judge carries forward how much of it was told, so skipping a key that had
  // been told about once meant this page cost nothing and the window stopped bounding anything.
  const again = judge(watching, raised({ subject: "seat-lead" }), NOW + minutes(3));
  assert.equal(again.urgency, "page");
  watching = delivered(again.watching, [key], NOW + minutes(3));
  assert.equal(watching.pages.length, 2, "the second interruption costs the second page");
  assert.equal(pagesLeft(watching, NOW + minutes(3)), 0);

  // And with the window spent, the next one waits for the report instead — and really does wait in it.
  const third = judge(watching, raised({ subject: "seat-lead" }), NOW + minutes(4));
  assert.equal(third.urgency, "digest");
  assert.deepEqual(
    pending(third.watching).map((strike) => strike.label),
    ["repetition"],
    "a fifth time is a time the owner has not been told about, whatever they were told about the fourth",
  );
});

test("a fault the owner has already been told about is owed to them again the next time it happens", () => {
  const key = keyOf("seat-lead", "repetition");
  let watching: Watching = emptyWatching();
  for (const at of [NOW, NOW + minutes(1), NOW + minutes(2)]) {
    const verdict = judge(watching, raised({ subject: "seat-lead" }), at);
    watching = verdict.urgency === "page" ? delivered(verdict.watching, [key], at) : verdict.watching;
  }
  assert.equal(watching.strikes[key]!.told, 3, "three occurrences, all three of them told");
  assert.deepEqual(pending(watching), [], "so nothing is owed");

  // It happens a fourth time. Asking only whether this key had ever been reported answered yes here,
  // which hid every recurrence from the report — the only reader left once the budget is spent or
  // nobody is seated above the Watcher to be interrupted.
  const again = judge(watching, raised({ subject: "seat-lead" }), NOW + minutes(3));
  assert.equal(again.strike!.told, 3, "what was told is carried forward, not what happened");
  assert.deepEqual(
    pending(again.watching).map((strike) => strike.count),
    [4],
    "a fourth occurrence against three told is one the owner is owed",
  );

  // Telling them settles the occurrences that had happened by then, and no more.
  const settled = delivered(again.watching, [key], NOW + minutes(3));
  assert.deepEqual(pending(settled), []);
  assert.deepEqual(pending(reported(settled, carriedBy(settled), NOW + minutes(3))).map((strike) => strike.label), [], "and the digest settles what it carried");
});
