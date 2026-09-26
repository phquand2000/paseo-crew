import assert from "node:assert/strict";
import { test } from "node:test";
import type { Layer } from "../../shared/settings.ts";
import { countsInstead } from "../../client/format/flow.ts";
import { incidentState } from "../../client/format/watch.ts";
import { dropMcp, foldRoles, keptRoles, modelRow, setAttention, setRole } from "../../client/model/layer.ts";
import type { WatchIncident } from "../../shared/views.ts";

const held: Layer = {
  rules: "Keep diffs small.",
  roles: { lead: { harness: "claude", model: "opus", thinking: "high", rules: "Never touch the generated client." } },
  attention: { longTurnMinutes: 30, watch: false },
};

test("changing a seat's agent forgets what was chosen for the old one and keeps what the owner wrote", () => {
  const moved = setRole(held, "lead", { harness: "omp" }, true);
  assert.deepEqual(moved.roles!.lead, { rules: "Never touch the generated client.", harness: "omp" });
  assert.equal(moved.rules, "Keep diffs small.", "what every seat is told is untouched");
  assert.deepEqual(moved.attention, { longTurnMinutes: 30, watch: false }, "and so is everything else in the layer");
});

test("changing a seat's model or thinking keeps the rest of its choice", () => {
  const remodelled = setRole(held, "lead", { model: "other" });
  assert.deepEqual(remodelled.roles!.lead, { harness: "claude", model: "other", thinking: "high", rules: "Never touch the generated client." });
});

test("running the setup screen over a project keeps what it holds, and does not pin the old agent's model on a new one", () => {
  const project: Layer = {
    rules: "Never touch the release branch.",
    mcp: { docs: { enabled: true, connect: { type: "http", url: "https://x", headers: { Authorization: "Bearer SECRET" } } } },
    attention: { longTurnMinutes: 45 },
    roles: { peer: { harness: "claude", model: "claude-opus-5", thinking: "high" } },
  };
  // What the dialog collected: one role moved to another agent. A write is the whole layer.
  const draft: Layer = { roles: { peer: { harness: "omp" } } };
  const folded = foldRoles(project, draft, (role) => project.roles?.[role]?.harness);

  assert.equal(folded.rules, "Never touch the release branch.", "the rule every seat is told survives");
  assert.equal(folded.mcp!.docs!.connect!.headers!.Authorization, "Bearer SECRET", "and so does the token the owner pasted");
  assert.deepEqual(folded.attention, { longTurnMinutes: 45 });
  assert.deepEqual(folded.roles!.peer, { harness: "omp" }, "the model and thinking level picked for the old agent are not kept on the new one");

  const same = foldRoles(project, { roles: { peer: { thinking: "low" } } }, (role) => project.roles?.[role]?.harness);
  assert.deepEqual(same.roles!.peer, { harness: "claude", model: "claude-opus-5", thinking: "low" });
});

test("a role whose agent is not recorded anywhere keeps the model the owner picked for it", () => {
  // A role nobody moved runs the kit's default agent, so no layer names it, yet the owner chose a model.
  const project: Layer = { roles: { peer: { model: "glm-5-air" } } };
  const draft: Layer = { roles: { peer: { harness: "omp" } } };

  const unknown = foldRoles(project, draft, () => undefined);
  assert.deepEqual(unknown.roles!.peer, { model: "glm-5-air", harness: "omp" }, "an agent nobody can name is not an agent being replaced");

  const moved = foldRoles(project, { roles: { peer: { harness: "claude" } } }, () => "omp");
  assert.deepEqual(moved.roles!.peer, { harness: "claude" });
});

test("re-pasting a server the owner gave to nobody leaves it given to nobody", () => {
  const reachable = ["supervisor", "lead", "peer", "reviewer"];
  // Unticking the last role writes an empty list; a re-paste to rotate the token once gave the server to all four.
  assert.deepEqual(keptRoles([], reachable), [], "a narrowing to nobody is a narrowing, not an absence");
  assert.deepEqual(keptRoles(undefined, reachable), reachable, "never narrowed is what does mean every reachable role");
  assert.deepEqual(keptRoles(["lead", "peer"], reachable), ["lead", "peer"]);
  assert.deepEqual(keptRoles(["lead", "designer"], reachable), ["lead"], "and a role that cannot reach it is dropped from the narrowing");
});

test("the model row shows what is in force even when this agent does not list it, and offers a way back", () => {
  const opus = [{ id: "claude-opus-5", label: "Opus 5" }];
  const settled = modelRow("claude-opus-5", opus);
  assert.equal(settled.stray, false);
  assert.deepEqual(settled.options, [{ label: "Opus 5", value: "claude-opus-5" }]);

  // The screen once printed "Opus 5" here, which is not what the seat runs, and rendered no control.
  const wrong = modelRow("glm-5-air", opus);
  assert.equal(wrong.value, "glm-5-air", "the seat's own model is what is shown");
  assert.equal(wrong.stray, true);
  assert.deepEqual(wrong.options, [{ label: "Opus 5", value: "claude-opus-5" }, { label: "glm-5-air", value: "glm-5-air" }], "and it stays pickable so the owner can move off it");
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

  // Lanes start collapsed, so the Lead's line is the only place a seat waiting on the owner shows.
  assert.equal(countsInstead(lane({ status: "running", waiting: ["Write outside the working copy"] })), false);
  assert.equal(countsInstead(lane({ status: "gone", waiting: [] })), false, "and a Lead that has gone is never news the counts may hide");
  assert.equal(countsInstead(lane(null)), false);
});

test("switching the watch on keeps the rest of the tuning", () => {
  const on = setAttention(held, { watch: true });
  assert.deepEqual(on.attention, { longTurnMinutes: 30, watch: true }, "the other attention settings are not a casualty of the switch");
  assert.equal(on.rules, "Keep diffs small.");
});

const incident = (over: Partial<WatchIncident> = {}): WatchIncident => ({
  id: "I1",
  title: "Built a stand-in for something that does not exist",
  level: "attend",
  name: "Peer · L1-T1 Pointer",
  minutes: 6,
  quote: "S9 said: patch.js is missing",
  told: null,
  lane: "L1",
  held: null,
  ...over,
});

test("an incident says where it has got to, in words", () => {
  assert.equal(incidentState(incident({ told: "supervisor" })), "told the Supervisor");
  assert.equal(incidentState(incident({ told: "lead" })), "told Lead L1");
  assert.equal(incidentState(incident({ told: "lead", lane: null })), "told its Lead");
  assert.equal(incidentState(incident({ held: "budget" })), "held · the lane's limit for today is reached");
  assert.equal(incidentState(incident({ held: "probation" })), "held · most of this kind's last ten were marked noise");
  assert.equal(incidentState(incident({ held: "nobody" })), "held · nobody is seated to tell");
  assert.equal(incidentState(incident({ held: "shadow" })), "recorded · mail is off");
  assert.equal(incidentState(incident()), "recorded");
});
