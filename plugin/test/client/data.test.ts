import assert from "node:assert/strict";
import { test } from "node:test";
import { KEPT, type Layer } from "../../shared/settings.ts";
import { countsInstead } from "../../client/format/flow.ts";
import { incidentState, judgeWords } from "../../client/format/watch.ts";
import { dropMcp, foldRoles, keptRoles, modelRow, setAttention, setRole, withKey } from "../../client/model/layer.ts";
import type { WatchIncident, WatchJudge } from "../../shared/flow-views.ts";

const docs = {
  enabled: true,
  label: "Docs",
  roles: ["lead"],
  connect: { type: "http" as const, url: "https://x", headers: { Authorization: "Bearer SECRET" } },
};
const lead = { harness: "claude", model: "opus", thinking: "high", rules: "Never touch the generated client." };
const held: Layer = {
  rules: "Keep diffs small.",
  roles: { lead },
  attention: { longTurnMinutes: 30, watch: false },
  mcp: { docs },
  sensor: { other: { key: KEPT } },
};
const { mcp: _mcp, ...undocked } = held;
const EDITS: [string, (layer: Layer) => Layer, Layer][] = [
  [
    "changing a seat's agent forgets what was chosen for the old one and keeps what the owner wrote",
    (layer) => setRole(layer, "lead", { harness: "omp" }, true),
    { ...held, roles: { lead: { rules: lead.rules, harness: "omp" } } },
  ],
  [
    "changing its model keeps the rest of its choice",
    (layer) => setRole(layer, "lead", { model: "other" }),
    { ...held, roles: { lead: { ...lead, model: "other" } } },
  ],
  [
    "switching the watch on keeps the rest of the tuning",
    (layer) => setAttention(layer, { watch: true }),
    { ...held, attention: { longTurnMinutes: 30, watch: true } },
  ],
  [
    "removing a server this layer added forgets it, token and all, rather than keeping it marked removed",
    (layer) => dropMcp(layer, "docs"),
    undocked,
  ],
  [
    "a key typed on the panel goes with the save beside the ones shown as KEPT",
    (layer) => withKey(layer, "jev", "a-new-key"),
    { ...held, sensor: { other: { key: KEPT }, jev: { key: "a-new-key" } } },
  ],
  [
    "forgetting one key leaves the others",
    (layer) => withKey({ ...layer, sensor: { ...layer.sensor, jev: { key: KEPT } } }, "jev", null),
    held,
  ],
  [
    "the last key forgotten leaves no sensor block",
    (layer) => withKey(layer, "other", null),
    { ...held, sensor: undefined },
  ],
];

test("a panel edit changes only what it names and keeps the rest of the layer", () => {
  for (const [what, edit, edited] of EDITS) assert.deepEqual(edit(held), edited, what);
});

test("running the setup screen over a project keeps what it holds, and drops the old agent's model only where an agent is really replaced", () => {
  const project: Layer = {
    rules: "Never touch the release branch.",
    mcp: { docs },
    attention: { longTurnMinutes: 45 },
    roles: { peer: { harness: "claude", model: "claude-opus-5", thinking: "high" } },
  };
  const recorded = (role: string) => project.roles?.[role]?.harness;
  assert.deepEqual(
    foldRoles(project, { roles: { peer: { harness: "omp" } } }, recorded),
    { ...project, roles: { peer: { harness: "omp" } } },
    "a write is the whole layer: the rules, the pasted token and the tuning survive, and the model and thinking picked for the old agent are not kept on the new one",
  );
  assert.deepEqual(foldRoles(project, { roles: { peer: { thinking: "low" } } }, recorded).roles?.peer, {
    harness: "claude",
    model: "claude-opus-5",
    thinking: "low",
  });
  const picked: Layer = { roles: { peer: { model: "glm-5-air" } } };
  assert.deepEqual(
    foldRoles(picked, { roles: { peer: { harness: "omp" } } }, () => undefined).roles?.peer,
    { model: "glm-5-air", harness: "omp" },
    "a role nobody moved runs the kit's default agent, which no layer names: an agent nobody can name is not one being replaced",
  );
  assert.deepEqual(foldRoles(picked, { roles: { peer: { harness: "claude" } } }, () => "omp").roles?.peer, {
    harness: "claude",
  });
});

test("re-pasting a server the owner gave to nobody leaves it given to nobody", () => {
  const reachable = ["supervisor", "lead", "peer", "reviewer"];
  assert.deepEqual(
    keptRoles([], reachable),
    [],
    "unticking the last role writes an empty list, a narrowing to nobody; a re-paste once gave the server to all four",
  );
  assert.deepEqual(keptRoles(undefined, reachable), reachable, "never narrowed is what does mean every reachable role");
  assert.deepEqual(keptRoles(["lead", "peer"], reachable), ["lead", "peer"]);
  assert.deepEqual(
    keptRoles(["lead", "designer"], reachable),
    ["lead"],
    "and a role that cannot reach it is dropped from the narrowing",
  );
});

test("the model row shows what is in force even when this agent does not list it, and offers a way back", () => {
  const opus = [{ id: "claude-opus-5", label: "Opus 5" }];
  const settled = modelRow("claude-opus-5", opus);
  assert.equal(settled.stray, false);
  assert.deepEqual(settled.options, [{ label: "Opus 5", value: "claude-opus-5" }]);
  const wrong = modelRow("glm-5-air", opus);
  assert.equal(
    wrong.value,
    "glm-5-air",
    "the seat's own model is what is shown, where the screen once printed Opus 5 and no control",
  );
  assert.equal(wrong.stray, true);
  assert.deepEqual(
    wrong.options,
    [
      { label: "Opus 5", value: "claude-opus-5" },
      { label: "glm-5-air", value: "glm-5-air" },
    ],
    "and it stays pickable so the owner can move off it",
  );
  assert.equal(modelRow("", opus).stray, false, "nothing chosen is not a stray choice");
});

test("a collapsed lane gives up its counts for a Lead that is waiting or gone", () => {
  const lane = (lead: { status: string; waiting: string[] } | null, open = false) => ({ taskCount: 3, open, lead });
  assert.equal(countsInstead(lane({ status: "running", waiting: [] })), true, "the ordinary case is the counts");
  assert.equal(
    countsInstead(lane({ status: "idle", waiting: [] }, true)),
    false,
    "an opened lane shows its Lead and its tasks",
  );
  assert.equal(countsInstead({ taskCount: 0, open: false, lead: { status: "idle", waiting: [] } }), false);
  assert.equal(
    countsInstead(lane({ status: "running", waiting: ["Write outside the working copy"] })),
    false,
    "lanes start collapsed, so the Lead's line is the only place a seat waiting on the owner shows",
  );
  assert.equal(
    countsInstead(lane({ status: "gone", waiting: [] })),
    false,
    "and a Lead that has gone is never news the counts may hide",
  );
  assert.equal(countsInstead(lane(null)), false);
});

const incident = (over: Partial<WatchIncident>): WatchIncident => ({
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
const INCIDENTS: [Partial<WatchIncident>, string][] = [
  [{ told: "supervisor" }, "told the Supervisor"],
  [{ told: "lead" }, "told Lead L1"],
  [{ told: "lead", lane: null }, "told its Lead"],
  [{ held: "budget" }, "held · the lane's limit for today is reached"],
  [{ held: "probation" }, "held · most of this kind's last ten were marked noise"],
  [{ held: "nobody" }, "held · nobody is seated to tell"],
  [{ held: "shadow" }, "recorded · mail is off"],
  [{}, "recorded"],
];
const judge = { label: "Jev", minutes: null, detail: null };
const kept = "Its answers are kept in assessments.log; no seat is sent them.";
const JUDGES: [WatchJudge, ReturnType<typeof judgeWords>][] = [
  [
    { ...judge, label: "", state: "off" },
    {
      title: "Nobody answers the watch's questions",
      hint: "Answered by is off: set it on Team, on the Watcher. The code's own facts go on.",
      tone: "muted",
    },
  ],
  [
    { ...judge, state: "nokey", detail: "OpenRouter key" },
    {
      title: "Jev is asked nothing: it has no key",
      hint: "Add its OpenRouter key on Team, under Machine defaults, on the Watcher. The code's own facts go on.",
      tone: "muted",
    },
  ],
  [
    { ...judge, state: "waiting" },
    { title: "Jev answers the watch's questions", hint: `Nothing has been asked of it yet. ${kept}`, tone: "success" },
  ],
  [
    { ...judge, state: "answering", minutes: 3 },
    { title: "Jev answers the watch's questions", hint: kept, tone: "success" },
  ],
  [
    { ...judge, state: "failing", minutes: 4, detail: "503: busy" },
    {
      title: "Jev is not answering",
      hint: "503: busy. The code's own facts go on; nothing waits for an answer.",
      tone: "warning",
    },
  ],
];

test("the watch card says in words where an incident has got to and who answers the watch's questions, and how that stands", () => {
  for (const [over, words] of INCIDENTS) assert.equal(incidentState(incident(over)), words);
  for (const [state, words] of JUDGES) assert.deepEqual(judgeWords(state), words, state.state);
});
