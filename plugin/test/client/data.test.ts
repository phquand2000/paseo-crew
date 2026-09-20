import assert from "node:assert/strict";
import { test } from "node:test";
import { type Layer, countsInstead, dropMcp, foldRoles, harnessInForce, keptRoles, modelInForce, modelRow, setAttention, setFlow, setMcp, setRole, setSensorKey, watchCard, watchState } from "../../client/data.ts";
import type { WatchView } from "../../shared/views.ts";
import { KEPT } from "../../shared/rpc.ts";

const held: Layer = {
  rules: "Keep diffs small.",
  roles: { lead: { harness: "claude", model: "opus", thinking: "high", rules: "Never touch the generated client." } },
  attention: { longTurnMinutes: 30, watch: false },
};

test("changing a seat's agent forgets what was chosen for the old one and keeps what the owner wrote", () => {
  const moved = setRole(held, "lead", { harness: "devin" }, true);
  assert.deepEqual(moved.roles!.lead, { rules: "Never touch the generated client.", harness: "devin" });
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
  const draft: Layer = { roles: { peer: { harness: "devin" } } };
  const folded = foldRoles(project, draft, (role) => project.roles?.[role]?.harness);

  assert.equal(folded.rules, "Never touch the release branch.", "the rule every seat is told survives");
  assert.equal(folded.mcp!.docs!.connect!.headers!.Authorization, "Bearer SECRET", "and so does the token the owner pasted");
  assert.deepEqual(folded.attention, { longTurnMinutes: 45 });
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
  const reachable = ["supervisor", "lead", "peer", "reviewer"];
  // Unticking the last role on a server's own tab writes an empty list, and the resolver honours it:
  // the server really is given to no role. Rotating its token is a re-paste of the same snippet, and
  // reading that empty list as "nothing to preserve" handed the server, and the new token, to all four.
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

test("the model in force follows the resolver: a layer naming another agent drops the models below it", () => {
  const lead = { id: "lead", defaults: { harness: "claude", model: "claude-opus-5" } };
  const machine: Layer = { roles: { lead: { harness: "devin", model: "swe-2-max" } } };
  // The nearest model the screen could find was the machine's, chosen for an agent the project had
  // since moved off — and it was shown, and folded into a save, as the one in force.
  assert.equal(modelInForce(lead, {}, { roles: { lead: { harness: "codex" } } }, machine), undefined);
  assert.equal(modelInForce(lead, {}, { roles: { lead: { harness: "claude" } } }, machine), "claude-opus-5", "back on its own agent, the kit's choice there");
  assert.equal(modelInForce(lead, { roles: { lead: { model: "claude-sonnet-5" } } }, undefined, machine), "claude-sonnet-5");
  assert.equal(modelInForce(lead), "claude-opus-5");
});

test("switching the watch on keeps the rest of the tuning, and the sensor's key is kept by the word the screen holds", () => {
  const on = setAttention(held, { watch: true });
  assert.deepEqual(on.attention, { longTurnMinutes: 30, watch: true }, "the other attention settings are not a casualty of the switch");
  assert.equal(on.rules, "Keep diffs small.");

  // The panel is only ever handed `KEPT`, and a write is the whole layer, so carrying that word back
  // is the whole of what keeps the key on disk through a save about something else. Every helper a
  // section saves through has to do it, not just this card's own.
  const screen: Layer = { ...held, sensor: { key: KEPT } };
  const elsewhere: Record<string, Layer> = {
    "a role moved to another agent": setRole(screen, "peer", { harness: "devin" }, true),
    "a server switched on": setMcp(screen, "docs", { enabled: true }),
    "a pasted server forgotten": dropMcp(setMcp(screen, "docs", { enabled: true }), "docs"),
    "the flow switch": setFlow(screen, { live: true }),
    "this card's own switch": setAttention(screen, { watch: true }),
  };
  for (const [what, saved] of Object.entries(elsewhere)) assert.deepEqual(saved.sensor, { key: KEPT }, `${what} carries the key back untouched`);
  assert.deepEqual(setSensorKey(screen, "sk-or-new").sensor, { key: "sk-or-new" }, "a typed key replaces the word");
  const forgotten = setSensorKey(screen, null);
  assert.equal("sensor" in forgotten, false, "forgetting it leaves no block at all, which is what clears the key on disk");
  assert.deepEqual(forgotten.attention, { longTurnMinutes: 30, watch: false }, "and nothing else goes with it");
});

test("with no key the Watch panel says the watch is off, and claims nothing is being marked", () => {
  const off = watchState(false, true, 5, "machine", "Set here");
  assert.equal(off.on, false);
  assert.equal(off.title, "The watch is off");
  // The sentence the owner quoted — "What the watch marks is recorded and listed" — was rendered next
  // to a row saying no seat is followed. With no key nothing is marked, so nothing may say it is.
  for (const line of [off.hint, off.mailHint, off.keyHint]) {
    assert.doesNotMatch(line, /\b(recorded|marked|listed|raised)\b/, line);
  }
  assert.match(off.mailHint, /Nothing is mailed while the watch is off/);
});

test("with a key the panel says the watch is on, and the mail line says which of the two it is", () => {
  const telling = watchState(true, true, 5, "machine", "Set here");
  assert.equal(telling.title, "The watch is on");
  assert.match(telling.hint, /runs in every project/);
  assert.match(telling.mailHint, /up to 5 a day/, "the count says what it counts");
  const quiet = watchState(true, false, 5, "project", "From this machine");
  assert.match(quiet.mailHint, /none is mailed/);
  assert.match(quiet.hint, /Flow tab/, "a project screen points at where the watch can be watched");
});

const watching = (over: Partial<WatchView> = {}): WatchView => ({
  on: true,
  telling: false,
  seats: [],
  lastRead: null,
  marks: { total: 0, open: 0, held: 0, useful: 0, noise: 0, recent: [] },
  trouble: [],
  ...over,
});

test("the watch card says what it has done in this project, not only what is running this second", () => {
  // The card an owner actually opened: a project worked in all day, every seat since archived. Fed
  // by the live watches alone it read "The watch is on / nothing to follow / 0 open incidents".
  const after = watchCard(watching({
    lastRead: 185,
    marks: { total: 2, open: 0, held: 0, useful: 0, noise: 2, recent: [{ id: "I1", kind: "test-weakened", where: "the Peer on L1-T1", state: "marked noise" }] },
  }));
  assert.equal(after.title, "The watch is on");
  assert.match(after.hint, /last read a turn here 3 hours ago/, "an idle watch says when it last worked, so a dead one is visible");
  assert.equal(after.marksTitle, "2 incidents here");
  assert.match(after.marksHint, /None still open\. Marked so far: 0 useful, 2 noise\./);
  assert.equal(after.right, null, "nothing is running, so there is no live tally to show");
});

test("a watch that has marked nothing teaches what it would mark, rather than printing a zero", () => {
  const fresh = watchCard(watching());
  assert.equal(fresh.marksTitle, "Nothing marked here yet");
  assert.doesNotMatch(fresh.marksTitle, /\b0\b/, "a count of nothing is not a heading");
  for (const what of [/destructive command/, /round in circles/, /lost its assertions/, /without a hand-back/, /sensor reads/]) {
    assert.match(fresh.marksHint, what, "the empty state is where someone finds out what the thing is for");
  }
  assert.match(fresh.hint, /read nothing here yet/);
});

test("while seats are running the card counts them, their readings and what they cost", () => {
  const live = watchCard(watching({
    telling: true,
    seats: [
      { id: "a", role: "lead", running: true, readings: 13, cost: 0.0018, minutes: 0, highest: null },
      { id: "b", role: "peer", running: false, readings: 43, cost: 0.0057, minutes: 2, highest: { question: "goal_drift", p: 0.81 } },
    ],
    marks: { total: 1, open: 1, held: 1, useful: 0, noise: 0, recent: [] },
  }));
  assert.equal(live.title, "Watching 2 seats");
  assert.equal(live.right, "56 read · 0.75¢");
  assert.match(live.hint, /goes to the Supervisor/);
  assert.match(live.marksHint, /1 still open, 1 of them held back\./);
  assert.match(live.marksHint, /None marked yet/);
});
