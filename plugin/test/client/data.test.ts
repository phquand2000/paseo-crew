import assert from "node:assert/strict";
import { test } from "node:test";
import { type Layer, foldRoles, setRole } from "../../client/data.ts";

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

test("running the setup screen over a project keeps what it holds, and does not pin the old agent's model on a new one", () => {
  const project: Layer = {
    rules: "Never touch the release branch.",
    mcp: { docs: { enabled: true, connect: { type: "http", url: "https://x", headers: { Authorization: "Bearer SECRET" } } } },
    attention: { digestMinutes: 45 },
    roles: { peer: { harness: "claude", model: "claude-opus-5", thinking: "high" } },
  };
  // What the dialog collected: one role moved to another agent. A write is the whole layer.
  const draft: Layer = { roles: { peer: { harness: "devin" } } };
  const folded = foldRoles(project, draft, (role) => project.roles?.[role]?.harness);

  assert.equal(folded.rules, "Never touch the release branch.", "the rule every seat is told survives");
  assert.equal(folded.mcp!.docs!.connect!.headers!.Authorization, "Bearer SECRET", "and so does the token the owner pasted");
  assert.deepEqual(folded.attention, { digestMinutes: 45 });
  assert.deepEqual(folded.roles!.peer, { harness: "devin" }, "the model and thinking level picked for the old agent are not kept on the new one");

  // A draft that changes nothing about the agent keeps what was chosen for it.
  const same = foldRoles(project, { roles: { peer: { thinking: "low" } } }, (role) => project.roles?.[role]?.harness);
  assert.deepEqual(same.roles!.peer, { harness: "claude", model: "claude-opus-5", thinking: "low" });
});
