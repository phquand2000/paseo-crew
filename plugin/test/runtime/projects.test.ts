import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { KEEP_CLOSED_LANES } from "../../server/desk/archive.ts";
import { saveLedger } from "../../server/desk/ledger.ts";
import { projectOf } from "../../server/desk/project.ts";
import { harness, repo } from "./harness.ts";

test("each project gets the agent and model its own settings choose, and the machine layer keeps the rest", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  await h.call(sup, "supervisor", "open_lane", {
    title: "Defaults",
    outcome: "a.txt changes",
    acceptance: ["one"],
    outOfScope: ["anything else in the repository"],
  });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", {
    tasks: [
      {
        key: "t",
        title: "Default peer",
        goal: "g",
        acceptance: ["a"],
        hints: ["a.txt"],
        outOfScope: ["the rest of the repository"],
      },
    ],
  });
  const onDefaults = h.agents.get(h.ledger().tasks["L1-T1"]!.peer!)!.provider;
  assert.equal(onDefaults, "sw2-peer-claude/claude-opus-5");
  assert.equal(h.agents.get(lane.lead!)!.provider, "sw2-lead-claude/claude-opus-5");

  writeFileSync(
    join(h.project.state, "settings.json"),
    JSON.stringify({ roles: { peer: { harness: "pi", model: "glm-5" } } }),
  );
  await h.call(h.ledger().tasks["L1-T1"]!.peer!, "peer", "done", { outcome: "complete", summary: "done" });
  h.commit(h.root, "a.txt", "one\n");
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  await h.call(lane.lead!, "lead", "add_tasks", {
    tasks: [
      {
        key: "t",
        title: "Pi peer",
        goal: "g",
        acceptance: ["a"],
        hints: ["b.txt"],
        outOfScope: ["the rest of the repository"],
      },
    ],
  });
  const switched = h.agents.get(h.ledger().tasks["L1-T2"]!.peer!)!.provider;
  assert.equal(switched, "sw2-peer-pi/glm-5");
  assert.equal(h.agents.get(lane.lead!)!.provider, "sw2-lead-claude/claude-opus-5");
});

test("what the desk opened and nothing holds any more is swept away without being asked", async () => {
  const h = harness();
  const tick = h.tick;
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", {
    title: "Swept",
    outcome: "a.txt changes",
    acceptance: ["a"],
    outOfScope: ["anything else in the repository"],
  });

  const ws = h.paseo as unknown as {
    workspaces: { create(options: { title: string; source: { kind: string; path: string } }): Promise<{ id: string }> };
  };
  const orphan = await ws.workspaces.create({
    title: `${h.project.slug} S9`,
    source: { kind: "directory", path: h.root },
  });
  const inPlace = [...h.workspaceNames.entries()].find(([, name]) => name === h.project.slug)![0];
  assert.equal(h.archivedWorkspaces.has(orphan.id), false, "the orphan starts out live");

  await tick();

  assert.equal(
    h.archivedWorkspaces.has(orphan.id),
    true,
    "a working copy the ledger no longer holds is put away by the desk, not by a human with a shell",
  );
  assert.equal(h.archivedWorkspaces.has(inPlace), false, "the copy the open lane is working in is left alone");
});

test("one workspace carries a whole project, and the desk puts it away when the project goes quiet", async () => {
  const h = harness();
  const tick = h.tick;
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", {
    title: "Quiet",
    outcome: "a.txt changes",
    acceptance: ["a"],
    outOfScope: ["anything else in the repository"],
  });
  const lane = h.ledger().lanes.L1!;

  const live = () =>
    [...h.workspaceNames.entries()].filter(
      ([id, name]) =>
        (name === h.project.slug || name.startsWith(`${h.project.slug} `)) && !h.archivedWorkspaces.has(id),
    );
  assert.equal(live().length, 1, "a lane takes the project's one working copy rather than opening one of its own");

  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "done" });
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  h.agents.get(sup)!.archivedAt = new Date().toISOString();
  await tick();

  assert.equal(
    live().length,
    0,
    "with the work finished and nobody seated, the desk takes back what it opened instead of leaving it for a human to delete",
  );
});

test("a project removed while the plugin runs is not written back by the round", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.tick(Date.now());
  assert.ok(existsSync(join(h.project.state, "status.md")), "a project on record has its status page");
  // Its seats gone: a live one is a project still in use, and seeing it records the project again.
  h.agents.get(sup)!.archivedAt = new Date().toISOString();
  rmSync(h.project.state, { recursive: true, force: true });
  await h.tick(Date.now());
  assert.equal(existsSync(h.project.state), false, "the Human removed it, and the round leaves it removed");
});

test("a ledger the desk cannot read is not written over, and the seat is told why", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Real work", outcome: "x", acceptance: ["a"], ...scope });
  assert.ok(h.ledger().lanes.L1, "there is something on record to lose");

  // Whatever wrote it, an unreadable ledger must not read like a project that has not started.
  const file = join(h.project.state, "ledger.json");
  const kept = '{ "lanes": ';
  writeFileSync(file, kept);

  const refused = await h.call(sup, "supervisor", "open_lane", {
    title: "After",
    outcome: "y",
    acceptance: ["a"],
    ...scope,
  });
  assert.equal(refused.ok, false);
  assert.match(
    refused.text,
    /could not be read/,
    "the seat is told, rather than getting a lane in a project that forgot the first one",
  );
  assert.equal(
    readFileSync(file, "utf-8"),
    kept,
    "an empty ledger written over it forgets every lane, task and working copy on record",
  );

  // Reading is held to the same rule: status used to answer "No open lanes."
  const status = await h.call(sup, "supervisor", "status", {});
  assert.equal(status.ok, false);
  assert.match(status.text, /could not be read/);
  assert.doesNotMatch(status.text, /No open lanes/);
});

test("two projects on one daemon both name their first task L1-T1, and both Leads are told when their Peer is gone", async () => {
  const h = harness();
  const second = repo();
  const other = projectOf(second.root);

  const open = async (where: string, name: string) => {
    const sup = h.add("sw2-supervisor-claude/claude-opus-5", where, name);
    await h.call(
      sup,
      "supervisor",
      "open_lane",
      { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["the rest"] },
      where,
    );
    const lane = h.ledger(where === h.root ? undefined : other).lanes.L1!;
    await h.call(
      lane.lead!,
      "lead",
      "add_tasks",
      {
        tasks: [
          { key: "t", title: "Add four", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] },
        ],
      },
      where,
    );
    return lane;
  };
  const here = await open(h.root, "sup-a");
  const there = await open(second.root, "sup-b");

  const mine = h.ledger().tasks.L1_T1 ?? h.ledger().tasks["L1-T1"]!;
  const theirs = h.ledger(other).tasks["L1-T1"]!;
  assert.equal(mine.id, theirs.id, "the two ledgers really do use the same task id");

  for (const task of [mine, theirs]) h.agents.get(task.peer!)!.archivedAt = new Date().toISOString();
  await h.tick(Date.now());
  await h.idle(here.lead!);
  await h.idle(there.lead!);

  assert.match(h.agents.get(here.lead!)!.sent.join("\n"), /the Peer on L1-T1/, "the first project's Lead is told");
  assert.match(
    h.agents.get(there.lead!)!.sent.join("\n"),
    /the Peer on L1-T1/,
    "and so is the second's — the letter key and the seen-it flag are per project",
  );
  assert.equal(
    h.ledger(other).tasks["L1-T1"]!.status,
    "stalled",
    "and the second project's task is recorded stalled, not skipped",
  );
});

test("a patrol round files finished lanes past the newest few into the archive, and leaves the rest", async () => {
  const h = harness();
  h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.tick(Date.now());
  const ledger = h.ledger();
  for (let n = 1; n <= KEEP_CLOSED_LANES + 1; n++) {
    ledger.lanes[`L${n}`] = {
      id: `L${n}`,
      title: `old ${n}`,
      outcome: "",
      acceptance: [],
      outOfScope: [],
      base: "main",
      branch: `lane/l${n}`,
      writeSet: [],
      contracts: [],
      opener: "sup",
      status: "closed",
      openedAt: n,
      tasks: 0,
      lead: `gone-lead-${n}`,
    };
  }
  ledger.seq.lane = KEEP_CLOSED_LANES + 1;
  saveLedger(h.project.state, ledger);
  mkdirSync(join(h.project.state, "handbacks"), { recursive: true });
  writeFileSync(join(h.project.state, "handbacks", "L1-T1-1.md"), "what L1 handed back");
  await h.tick(Date.now());
  assert.ok(!existsSync(join(h.project.state, "handbacks", "L1-T1-1.md")), "its hand-back went with it");
  assert.equal(h.ledger().lanes.L1, undefined, "the oldest finished lane left the ledger");
  assert.equal(Object.keys(h.ledger().lanes).length, KEEP_CLOSED_LANES);
  const filed = gunzipSync(readFileSync(join(h.project.state, "archive", "L1.json.gz"))).toString("utf-8");
  assert.match(filed, /"id":"L1"/);
  assert.match(filed, /what L1 handed back/);
});
