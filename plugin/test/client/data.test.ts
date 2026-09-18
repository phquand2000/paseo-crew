import assert from "node:assert/strict";
import { test } from "node:test";
import { type Layer, countsInstead, dropMcp, foldRoles, harnessInForce, keptRoles, modelRow, setRole } from "../../client/data.ts";

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

test("a role whose agent is not recorded anywhere keeps the model the owner picked for it", () => {
  // The ordinary state of a role nobody has moved: it runs the kit's default agent, so no layer says
  // which agent that is, and the owner has still chosen a model for it on the Team tab.
  const project: Layer = { roles: { peer: { model: "swe-2-medium" } } };
  const draft: Layer = { roles: { peer: { harness: "devin" } } };

  const unknown = foldRoles(project, draft, () => undefined);
  assert.deepEqual(unknown.roles!.peer, { model: "swe-2-medium", harness: "devin" }, "an agent nobody can name is not an agent being replaced");

  // And when it can be named and really is different, the old agent's model does go.
  const moved = foldRoles(project, { roles: { peer: { harness: "claude" } } }, () => "devin");
  assert.deepEqual(moved.roles!.peer, { harness: "claude" });
});

test("re-pasting a server the owner gave to nobody leaves it given to nobody", () => {
  const reachable = ["supervisor", "lead", "peer", "reviewer", "watcher"];
  // Unticking the last role on a server's own tab writes an empty list, and the resolver honours it:
  // the server really is given to no role. Rotating its token is a re-paste of the same snippet, and
  // reading that empty list as "nothing to preserve" handed the server, and the new token, to all five.
  assert.deepEqual(keptRoles([], reachable), [], "a narrowing to nobody is a narrowing, not an absence");
  assert.deepEqual(keptRoles(undefined, reachable), reachable, "never narrowed is what does mean every reachable role");
  assert.deepEqual(keptRoles(["lead", "peer"], reachable), ["lead", "peer"]);
  assert.deepEqual(keptRoles(["lead", "designer"], reachable), ["lead"], "and a role that cannot reach it is dropped from the narrowing");
});

test("a settings screen offers the agent in force, not the one the kit would have picked", () => {
  const peer = { id: "peer", defaults: { harness: "devin" } };
  const project: Layer = { roles: { peer: { harness: "claude" } } };
  const machine: Layer = { roles: { peer: { harness: "codex" } } };

  // Skipping the two middle layers is what showed Devin for a Peer the owner had put on Claude Code,
  // and then offered Devin's models for it.
  assert.equal(harnessInForce(peer, {}, project, machine), "claude", "the project's choice wins");
  assert.equal(harnessInForce(peer, {}, {}, machine), "codex", "then the machine's");
  assert.equal(harnessInForce(peer, {}, {}, {}), "devin", "and the kit's default only when nobody chose");
  assert.equal(harnessInForce(peer, { roles: { peer: { harness: "codex" } } }, project, machine), "codex", "a draft being filled in wins over both");
  assert.equal(harnessInForce(peer, undefined, undefined), "devin", "a layer not read yet is not a choice");
});

test("the model row shows what is in force even when this agent does not list it, and offers a way back", () => {
  const opus = [{ id: "claude-opus-5", label: "Opus 5" }];
  const settled = modelRow("claude-opus-5", opus);
  assert.equal(settled.stray, false);
  assert.deepEqual(settled.options, [{ label: "Opus 5", value: "claude-opus-5" }]);

  // What a wrong agent's model list leaves behind. The screen used to print "Opus 5" here, which is
  // not what the seat runs, and rendered no control because the agent lists only one.
  const wrong = modelRow("swe-2-medium", opus);
  assert.equal(wrong.value, "swe-2-medium", "the seat's own model is what is shown");
  assert.equal(wrong.stray, true);
  assert.deepEqual(wrong.options, [{ label: "Opus 5", value: "claude-opus-5" }, { label: "swe-2-medium", value: "swe-2-medium" }], "and it stays pickable so the owner can move off it");
  assert.equal(modelRow("", opus).stray, false, "nothing chosen is not a stray choice");
});

test("removing a server this layer added forgets it, token and all", () => {
  const held: Layer = {
    rules: "Keep diffs small.",
    mcp: { docs: { enabled: true, label: "Docs", roles: ["lead"], connect: { type: "http", url: "https://x", headers: { Authorization: "Bearer SECRET" } } } },
  };
  const dropped = dropMcp(held, "docs");
  assert.equal(dropped.mcp, undefined, "the entry goes, rather than staying on disk marked removed");
  assert.equal(dropped.rules, "Keep diffs small.", "and nothing else in the layer is touched");
  assert.equal(JSON.stringify(dropped).includes("SECRET"), false, "so the token is really gone");
});

test("a collapsed lane gives up its counts for a Lead that is waiting or gone", () => {
  const lane = (lead: { status: string; waiting: string[] } | null, open = false) => ({ taskCount: 3, open, lead });
  assert.equal(countsInstead(lane({ status: "running", waiting: [] })), true, "the ordinary case is the counts");
  assert.equal(countsInstead(lane({ status: "idle", waiting: [] }, true)), false, "an opened lane shows its Lead and its tasks");
  assert.equal(countsInstead({ taskCount: 0, open: false, lead: { status: "idle", waiting: [] } }), false);

  // Lanes start collapsed, and the Lead's line is the only place this screen shows a seat waiting on
  // the owner: blocked on a permission, a Lead read as "3 tasks, 1 running" in healthy green.
  assert.equal(countsInstead(lane({ status: "running", waiting: ["Write outside the working copy"] })), false);
  assert.equal(countsInstead(lane({ status: "gone", waiting: [] })), false, "and a Lead that has gone is never news the counts may hide");
  assert.equal(countsInstead(lane(null)), false);
});
