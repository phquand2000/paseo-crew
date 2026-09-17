import assert from "node:assert/strict";
import { test } from "node:test";
import { type Layer, setRole } from "../../client/data.ts";

const held: Layer = {
  rules: "Keep diffs small.",
  roles: { lead: { harness: "claude", model: "opus", thinking: "high", rules: "Never touch the generated client." } },
  attention: { digestMinutes: 30, watch: false },
};

test("changing a seat's agent forgets what was chosen for the old one and keeps what the owner wrote", () => {
  const moved = setRole(held, "lead", { harness: "devin" }, true);
  assert.deepEqual(moved.roles!.lead, { rules: "Never touch the generated client.", harness: "devin" });
  assert.equal(moved.rules, "Keep diffs small.", "what every seat is told is untouched");
  assert.deepEqual(moved.attention, { digestMinutes: 30, watch: false }, "and so is everything else in the layer");
});

test("changing a seat's model or thinking keeps the rest of its choice", () => {
  const remodelled = setRole(held, "lead", { model: "other" });
  assert.deepEqual(remodelled.roles!.lead, { harness: "claude", model: "other", thinking: "high", rules: "Never touch the generated client." });
});
