import assert from "node:assert/strict";
import { test } from "node:test";
import { findMarkers, findPushback } from "./signals.ts";

test("findMarkers collects decision, detour and handoff lines that open a line", () => {
  const text = [
    "Working notes.",
    "- DECISION: store totals in cents (alternatives: floats; reverse if rounding is needed)",
    "> DETOUR: no migration tool exists yet",
    "## HANDOFF",
    "the word DECISION: mid-sentence does not count",
  ].join("\n");
  assert.deepEqual(findMarkers(text), [
    { trigger: "decision", what: "a ruling was recorded", lines: ["- DECISION: store totals in cents (alternatives: floats; reverse if rounding is needed)"] },
    { trigger: "detour", what: "a missing foundation paused a slice", lines: ["> DETOUR: no migration tool exists yet"] },
    { trigger: "handoff", what: "a handoff block was written", lines: ["## HANDOFF"] },
  ]);
  assert.deepEqual(findMarkers("nothing to see"), []);
});

test("findPushback returns the first pushback line", () => {
  assert.equal(findPushback("done\n`BLOCKED` on missing auth token\nREOPEN_REQUEST: API"), "`BLOCKED` on missing auth token");
  assert.equal(findPushback("all green"), undefined);
});
