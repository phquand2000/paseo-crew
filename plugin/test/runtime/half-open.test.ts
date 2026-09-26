import assert from "node:assert/strict";
import { join } from "node:path";
import { mock, test } from "node:test";
import { saveLedger } from "../../server/desk/store/ledger.ts";
import { settle } from "./fake-timeline.ts";
import { harness, laneWithPeer } from "./harness.ts";

test("a lane a stop left half-open gives back what it took: one that waited waits again and opens, one never answered is closed and told", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", ...scope, isolate: true });
  await h.call(sup, "supervisor", "open_lane", { title: "Order", ...scope, after: ["L1"], isolate: true });
  // The desk stopped after L1 landed, with L2 claimed and a copy reserved for it, and with L3 mid-open in the Human's copy.
  h.git(h.root, "switch", "-qc", "lane/l3-aside");
  const ledger = h.ledger();
  Object.assign(ledger.lanes.L1!, { status: "closed", landed: true });
  ledger.lanes.L2!.status = "open";
  ledger.slots.S9 = { id: "S9", path: join(h.project.state, "gone-S9"), createdAt: Date.now(), lane: "L2" };
  ledger.lanes.L3 = {
    ...ledger.lanes.L1!,
    id: "L3",
    title: "Aside",
    branch: "lane/l3-aside",
    status: "open",
    landed: undefined,
    lead: undefined,
    slot: undefined,
    worktree: h.root,
    workspaceId: "gone",
  };
  ledger.seq.lane = 3;
  saveLedger(h.project.state, ledger);

  await h.tick(Date.now());
  const after = h.ledger();
  assert.equal(after.slots.S9, undefined, "the copy reserved before the stop is given back");
  assert.equal(after.lanes.L2!.status, "open");
  assert.ok(after.lanes.L2!.lead, "and the lane that waited is opened again, with a Lead");
  assert.equal(
    after.lanes.L3!.status,
    "closed",
    "a lane whose opening was never answered is not opened behind its Supervisor",
  );
  assert.deepEqual(
    [after.lanes.L3!.worktree, after.lanes.L3!.workspaceId],
    [undefined, undefined],
    "and keeps no copy it gave back on record",
  );
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main", "the Human's copy is back on its base");
  assert.equal(h.git(h.root, "branch", "--list", "lane/l3-aside").trim(), "");
  assert.match(
    h.agents.get(sup)!.sent.join("\n"),
    /NOT OPENED L3 \(Aside\): the desk stopped while its Lead was being started/,
  );
});

test("a round while a lane's Lead is still being started leaves that lane alone", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const paseo = h.paseo as unknown as {
    workspaces: { ref(id: string): { agents: { create(options: unknown): Promise<unknown> } } };
  };
  const ref = paseo.workspaces.ref;
  let go!: () => void;
  const held = new Promise<void>((resolve) => (go = resolve));
  paseo.workspaces.ref = (id) => {
    const workspace = ref(id);
    const create = workspace.agents.create;
    workspace.agents.create = async (options) => (await held, create(options));
    return workspace;
  };
  const opening = h.call(sup, "supervisor", "open_lane", {
    title: "Slow",
    outcome: "x",
    acceptance: ["a"],
    outOfScope: ["the rest"],
    isolate: true,
  });
  const starting = () => Object.values(h.ledger().slots).some((slot) => slot.lane === "L1" && slot.workspaceId);
  for (let i = 0; i < 200 && !starting(); i++) await settle();
  assert.ok(starting(), "its Lead is being started in a copy of its own");
  await h.tick(Date.now());
  assert.equal(h.ledger().lanes.L1!.status, "open", "not taken for one a stop left half-open");
  go();
  assert.equal((await opening).ok, true);
  assert.ok(h.ledger().lanes.L1!.lead);
});

test("a Lead Paseo started before a stop kept the desk from recording it is taken on, not left writing in a copy given back", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", {
    title: "Cart",
    outcome: "x",
    acceptance: ["a"],
    outOfScope: ["the rest"],
  });
  const opened = h.ledger().lanes.L1!;
  // The desk stopped after Paseo seated the Lead in the Human's copy and before the ledger said so.
  const ledger = h.ledger();
  delete ledger.lanes.L1!.lead;
  delete ledger.agents[opened.lead!];
  saveLedger(h.project.state, ledger);

  await h.tick(Date.now());
  const lane = h.ledger().lanes.L1!;
  assert.deepEqual([lane.status, lane.lead, h.ledger().agents[opened.lead!]?.lane], ["open", opened.lead, "L1"]);
  assert.equal(
    h.git(h.root, "branch", "--show-current").trim(),
    opened.branch,
    "the copy its Lead writes in is left where it is",
  );
  assert.equal(
    [...h.agents.values()].filter((agent) => agent.title.startsWith("L1 · Lead")).length,
    1,
    "and no second Lead is started",
  );
  assert.match(
    h.heard(sup).join("\n"),
    /OPENED L1 \(Cart\): the desk stopped while its Lead was being started, and that Lead, [^,]+, is kept on it/,
  );
});

test("a lane whose Lead is gone gets a new one where it stands, with the asks that waited on the old one, and its Supervisor is told once", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  assert.match(
    (await h.call(sup, "supervisor", "replace_lead", { lane: "L1" })).text,
    /still seated; message it instead/,
  );
  assert.equal((await h.call(peer, "peer", "ask", { question: "Which rounding?", bestGuess: "half up" })).ok, true);
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();

  const replaced = await h.call(sup, "supervisor", "replace_lead", { lane: "L1" });
  assert.equal(replaced.ok, true, replaced.text);
  const now = h.ledger().lanes.L1!;
  assert.notEqual(now.lead, lane.lead);
  assert.notEqual(now.lead, peer, "a Peer carries the lane's label too, and is not taken for its Lead");
  const seated = h.agents.get(now.lead!)!;
  assert.equal(seated.cwd, lane.worktree, "in the copy the lane already has, on its branch");
  assert.match(
    seated.prompt ?? "",
    new RegExp(`^You take over L1 from its Lead ${lane.lead}, which is gone\\.[^]*OWNER DIRECTIVE L1: Build`),
  );
  assert.doesNotMatch(seated.prompt ?? "", /supervisor/i, "a Lead is not shown the word its role hides");
  assert.deepEqual(
    Object.values(h.ledger().asks).map((ask) => ask.to),
    [now.lead],
    "the ask that waited on the old Lead waits on the new one",
  );
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "and the lane's task carries on");

  h.agents.get(now.lead!)!.archivedAt = new Date().toISOString();
  await h.tick(Date.now());
  // Past the half hour the mail itself counts a letter as new again.
  mock.timers.enable({ apis: ["Date"], now: Date.now() + 31 * 60_000 });
  try {
    await h.tick(Date.now());
  } finally {
    mock.timers.reset();
  }
  const mail = h.agents.get(sup)!.sent.join("\n---\n");
  assert.equal(mail.match(/LEAD GONE L1/g)?.length, 1, mail);
  assert.match(
    mail,
    /LEAD GONE L1 \(Build\): its Lead [^ ]+ is no longer seated[^]*replace_lead puts a new Lead on it where it stands/,
  );
});

test("a Lead Paseo seated for a lane but the ledger never recorded is taken on rather than seating a second", async () => {
  const { h, sup, lane } = await laneWithPeer();
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  const orphan = h.add("sw2-lead-claude/claude-opus-5", lane.worktree!, "L1 Build", "idle", undefined, {
    "seatworks.project": h.project.slug,
    "seatworks.lane": "L1",
    "seatworks.role": "lead",
  });
  const before = h.agents.size;
  const replaced = await h.call(sup, "supervisor", "replace_lead", { lane: "L1" });
  assert.match(replaced.text, new RegExp(`the Lead ${orphan} that Paseo already had seated for it`));
  assert.deepEqual([h.ledger().lanes.L1!.lead, h.agents.size], [orphan, before]);
});

test("a project is not detached while a seat still works in it, since that seat would put it back on record", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.tick(Date.now());
  const refused = (await h.runtime.control.removeProject(h.project.slug)) as { error?: string };
  assert.match(refused.error ?? "", new RegExp(`1 seat is still working in it \\(${sup}\\): archive it first`));
  h.agents.get(sup)!.archivedAt = new Date().toISOString();
  assert.deepEqual(await h.runtime.control.removeProject(h.project.slug), { removed: h.project.slug });
});

test("a task left running with no Peer by a stop starts again if it waited, and is cut with its Lead told if not", async () => {
  const { h, lane } = await laneWithPeer();
  const ledger = h.ledger();
  const base = {
    lane: "L1",
    kind: "code" as const,
    mode: "lane" as const,
    goal: "g",
    acceptance: ["a"],
    hints: ["b.txt"],
    holds: [],
    outOfScope: [],
    branch: lane.branch,
    worktree: lane.worktree,
    status: "running" as const,
    openedAt: Date.now(),
    updatedAt: Date.now(),
    silent: 0,
  };
  ledger.tasks["L1-T1"]!.status = "merged";
  ledger.tasks["L1-T2"] = { ...base, id: "L1-T2", title: "Waited", opening: { role: "peer" }, after: ["L1-T1"] };
  ledger.tasks["L1-T3"] = { ...base, id: "L1-T3", title: "Straight" };
  ledger.lanes.L1!.tasks = 3;
  saveLedger(h.project.state, ledger);
  await h.tick(Date.now());
  const after = h.ledger().tasks;
  assert.equal(after["L1-T2"]!.status, "running");
  assert.ok(after["L1-T2"]!.peer, "a task that waited goes back to waiting and starts again");
  assert.equal(after["L1-T3"]!.status, "cut");
  await h.idle(lane.lead!);
  assert.match(
    h.agents.get(lane.lead!)!.sent.join("\n"),
    /NOT STARTED L1-T3 \(Straight\): the desk stopped while its Peer was being started, so it is cut\.\n\nNext: add_tasks it again if you still want it/,
  );
});

test("a task whose Peer Paseo had started before a stop is taken on, not started twice", async () => {
  const { h, lane } = await laneWithPeer();
  const ledger = h.ledger();
  ledger.tasks["L1-T1"]!.status = "merged";
  ledger.tasks["L1-T2"] = {
    id: "L1-T2",
    title: "Seated",
    lane: "L1",
    kind: "code",
    mode: "lane",
    goal: "g",
    acceptance: ["a"],
    hints: ["b.txt"],
    holds: [],
    outOfScope: [],
    branch: lane.branch,
    worktree: lane.worktree,
    status: "running",
    opening: { role: "peer" },
    openedAt: Date.now(),
    updatedAt: Date.now(),
    silent: 0,
  };
  ledger.lanes.L1!.tasks = 2;
  saveLedger(h.project.state, ledger);
  const already = h.add("sw2-peer-claude/claude-opus-5", lane.worktree!, "L1-T2 Seated", "running", "brief", {
    "seatworks.project": h.project.slug,
    "seatworks.lane": "L1",
    "seatworks.task": "L1-T2",
    "seatworks.role": "peer",
  });
  const seats = h.agents.size;
  await h.tick(Date.now());
  assert.equal(h.ledger().tasks["L1-T2"]!.peer, already);
  assert.equal(h.agents.size, seats, "no second Peer");
});

test("a round while a task's Peer is being started leaves it to start, rather than taking it for one a stop left", async () => {
  const { h, lane } = await laneWithPeer();
  h.agents.get(h.ledger().tasks["L1-T1"]!.peer!)!.status = "idle";
  // The round runs while Paseo is still creating the Peer: the task is recorded running and has no Peer yet.
  const workspaces = (
    h.paseo as unknown as {
      workspaces: { ref(id: string): { agents: { create(options: unknown): Promise<unknown> } } };
    }
  ).workspaces;
  const ref = workspaces.ref.bind(workspaces);
  workspaces.ref = (id) => {
    const found = ref(id);
    const create = found.agents.create.bind(found.agents);
    found.agents.create = async (options) => {
      await h.tick(Date.now());
      return create(options);
    };
    return found;
  };
  const started = await h.call(lane.lead!, "lead", "add_tasks", {
    tasks: [
      {
        key: "t",
        title: "Beside",
        goal: "g",
        acceptance: ["a"],
        holds: ["c.txt"],
        outOfScope: ["the rest"],
        parallel: true,
      },
    ],
  });
  assert.equal(started.ok, true, started.text);
  const task = h.ledger().tasks["L1-T2"]!;
  assert.deepEqual([task.status, Boolean(task.peer)], ["running", true]);
});
