import assert from "node:assert/strict";
import { test } from "node:test";
import { blocks, clip, dependencyRequest, outcomeOf } from "./markers.ts";

test("blocks finds each marker and keeps its body until the next one", () => {
  const text = [
    "Slice S2 is merged.",
    "",
    "REPORT: plan cut",
    "- commits a1b2c3",
    "**NEED:** a build slot for S3",
    "QUESTION (concept): should guests see prices?",
    "Recommendation: yes",
    "Default: yes",
  ].join("\n");
  const found = blocks(text);
  assert.deepEqual(
    found.map((block) => block.kind),
    ["REPORT", "NEED", "QUESTION"],
  );
  assert.equal(found[0]?.text, "REPORT: plan cut\n- commits a1b2c3");
  assert.match(found[2]?.text ?? "", /Default: yes$/);
});

test("blocks ignores markers that are not at the start of a line", () => {
  assert.deepEqual(blocks("I will not say NEED: here because it is mid-line."), []);
});

test("outcome and dependency request are read from a hand-back", () => {
  const text = "Outcome: blocked\nDEPENDENCY_REQUEST: the migration number from the lane owner\n";
  assert.equal(outcomeOf(text), "blocked");
  assert.equal(dependencyRequest(text), "the migration number from the lane owner");
  assert.equal(outcomeOf("**Outcome:** done"), "done");
});

test("clip leaves short text alone and marks long text", () => {
  assert.deepEqual(clip("short", 10), { text: "short", clipped: false });
  const long = clip("x".repeat(50), 10);
  assert.equal(long.clipped, true);
  assert.match(long.text, /40 more characters/);
});
