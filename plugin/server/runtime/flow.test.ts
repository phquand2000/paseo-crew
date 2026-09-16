import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HOME = mkdtempSync(join(tmpdir(), "sw2-flow-home-"));
process.env.HOME = HOME;

const { loadKit } = await import("../catalog/kit.ts");
const { loadLedger } = await import("../desk/ledger.ts");
const { projectOf } = await import("../desk/project.ts");
const { Runtime } = await import("./runtime.ts");
const { firstOverlap, serialHits, SERIAL_ONLY } = await import("../core/scope.ts");

type Fake = { id: string; provider: string; cwd: string; title: string; status: string; archivedAt: string | null; updatedAt: string; sent: string[]; prompt?: string };

function fakePaseo() {
  const agents = new Map<string, Fake>();
  const workspaces = new Map<string, string>();
  let count = 0;
  const ref = (id: string) => {
    const agent = agents.get(id);
    return {
      id,
      get status() { return agent?.status ?? null; },
      get cwd() { return agent?.cwd ?? null; },
      get archivedAt() { return agent?.archivedAt ?? null; },
      get pendingPermissions() { return []; },
      async refresh() {},
      current() { return agent ? { id: agent.id, provider: agent.provider, cwd: agent.cwd, title: agent.title } : null; },
      async send(text: string) { agent?.sent.push(text); },
      async archive() { if (agent) Object.assign(agent, { archivedAt: new Date().toISOString(), status: "closed" }); },
    };
  };
  const add = (provider: string, cwd: string, title: string, status = "idle", prompt?: string) => {
    const id = `agent-${++count}`;
    agents.set(id, { id, provider, cwd, title, status, archivedAt: null, updatedAt: new Date().toISOString(), sent: [], prompt });
    return id;
  };
  const workspace = (id: string) => ({
    id,
    agents: {
      async create(options: { config: { provider: string }; title: string; prompt: string }) {
        return ref(add(options.config.provider, workspaces.get(id)!, options.title, "running", options.prompt));
      },
    },
  });
  const paseo = {
    agents: {
      ref,
      async list() {
        return { entries: [...agents.values()].map((agent) => ({ agent: { ...agent, pendingPermissions: [] } })) };
      },
    },
    workspaces: {
      async create({ source }: { source: { path: string } }) {
        const id = `ws-${workspaces.size + 1}`;
        workspaces.set(id, source.path);
        return workspace(id);
      },
      ref: workspace,
    },
  };
  return { paseo: paseo as never, agents, add, workspaces };
}

function repo(): { root: string; git: (cwd: string, ...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), "sw2-flow-repo-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(root, "b.txt"), "bee\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "seed");
  return { root, git };
}

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

const ideCalls: { kind: "open" | "sync"; path: string }[] = [];
const ide = {
  async open(path: string) {
    ideCalls.push({ kind: "open" as const, path });
    return { ok: true, text: "opened" };
  },
  async sync(path: string) {
    ideCalls.push({ kind: "sync" as const, path });
    return { ok: true, text: "synced" };
  },
};

function harness(outbox: string) {
  const { root, git } = repo();
  const state = join(HOME, ".local", "share", "seatworks-v2");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "settings.json"), JSON.stringify({ mcp: { "intellij-index": { enabled: true }, "code-search": { enabled: true }, context7: { enabled: true } } }));
  const { paseo, agents, add, workspaces } = fakePaseo();
  const runtime = new Runtime(kit, { outboxFile: join(HOME, outbox), codeIndex: (proxy: { id: string; gitExclude?: string[] }) => ({ ...ide, id: proxy.id, gitExclude: proxy.gitExclude ?? [] }), reloadDaemon: async () => true });
  const project = projectOf(root);
  let n = 0;
  const call = async (agent: string, role: string, tool: string, args: Record<string, unknown>) =>
    runtime.desk.handle(paseo, { id: `${outbox}-${++n}`, agent, role, tool, args, cwd: root, at: Date.now() });
  const idle = async (id: string) => {
    agents.get(id)!.status = "idle";
    runtime.outbox.turnEnded(id);
    await runtime.outbox.pump(paseo, id);
  };
  const commit = (cwd: string, file: string, text: string) => {
    writeFileSync(join(cwd, file), text);
    git(cwd, "add", "-A");
    git(cwd, "commit", "-qm", `edit ${file}`);
  };
  const ledger = () => loadLedger(project.state);
  return { root, git, paseo, agents, add, workspaces, runtime, project, call, idle, commit, ledger };
}

test("write sets overlap by path prefix and glob, and serial-only paths are caught", () => {
  assert.equal(firstOverlap(["src/pages/"], ["src/api/"]), undefined);
  assert.ok(firstOverlap(["src/"], ["src/api/users.ts"]));
  assert.ok(firstOverlap(["src/**/*.ts"], ["src/api/users.ts"]));
  assert.ok(firstOverlap(["**/*.ts"], ["lib/x.ts"]));
  assert.deepEqual(serialHits(["db/migrations/0003.sql", "src/app.ts"], SERIAL_ONLY), ["db/migrations/0003.sql"]);
  assert.deepEqual(serialHits(["Assets/Scenes/Main.unity"], SERIAL_ONLY), ["Assets/Scenes/Main.unity"]);
});

test("a lane works serially in one long-lived working copy that the next lane reuses", async () => {
  const h = harness("outbox-serial.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "test ! -f BROKEN" });
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"] });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  const slot = h.ledger().slots.S0!;
  assert.equal(h.agents.get(lane.lead!)!.cwd, slot.path);
  assert.equal(h.git(slot.path, "branch", "--show-current").trim(), lane.branch);
  assert.deepEqual(ideCalls.filter((call) => call.path === slot.path), [{ kind: "open", path: slot.path }]);
  assert.match(h.git(h.root, "rev-parse", "--git-path", "info/exclude").trim() && readFileSync(join(h.root, ".git", "info", "exclude"), "utf-8"), /^\.idea\/$/m);
  assert.equal(h.git(slot.path, "status", "--porcelain"), "");

  const second = await h.call(sup, "supervisor", "open_lane", { title: "Other", outcome: "x", acceptance: ["y"] });
  assert.equal(second.ok, false);
  assert.match(second.text, /1 at a time/);

  const unbounded = await h.call(lane.lead!, "lead", "start_task", { title: "Add four", goal: "g", acceptance: ["a"], owned: ["a.txt"] });
  assert.equal(unbounded.ok, false);
  assert.match(unbounded.text, /out of scope/);

  const t1 = await h.call(lane.lead!, "lead", "start_task", { title: "Add four", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  assert.equal(t1.ok, true, t1.text);
  const task1 = h.ledger().tasks["L1-T1"]!;
  assert.equal(h.agents.get(task1.peer!)!.cwd, slot.path);
  assert.equal(task1.branch, lane.branch);
  const blocked = await h.call(lane.lead!, "lead", "start_task", { title: "More", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  assert.equal(blocked.ok, false);
  assert.match(blocked.text, /one writer at a time/);

  writeFileSync(join(slot.path, "a.txt"), "one\ntwo\nthree\nfour\n");
  assert.equal((await h.call(task1.peer!, "peer", "done", { outcome: "complete", summary: "four" })).ok, true);
  h.agents.get(task1.peer!)!.status = "idle";
  const dirty = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(dirty.ok, false);
  assert.match(dirty.text, /uncommitted/);
  h.git(slot.path, "commit", "-qam", "add four");
  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(accepted.ok, true, accepted.text);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.ok(h.agents.get(task1.peer!)!.archivedAt);

  await h.call(lane.lead!, "lead", "start_task", { title: "Break it", goal: "g", acceptance: ["a"], owned: ["BROKEN"], outOfScope: ["the rest of the repository"] });
  const task2 = h.ledger().tasks["L1-T2"]!;
  h.commit(slot.path, "BROKEN", "x\n");
  const cut = await h.call(lane.lead!, "lead", "cut", { task: "L1-T2", reason: "wrong" });
  assert.equal(cut.ok, true, cut.text);
  assert.equal(existsSync(join(slot.path, "BROKEN")), false);
  assert.ok(h.agents.get(task2.peer!)!.archivedAt);

  await h.call(lane.lead!, "lead", "start_task", { title: "Late break", goal: "g", acceptance: ["a"], owned: ["BROKEN"], outOfScope: ["the rest of the repository"] });
  const task3 = h.ledger().tasks["L1-T3"]!;
  h.commit(slot.path, "BROKEN", "late\n");
  await h.call(task3.peer!, "peer", "done", { outcome: "complete", summary: "late" });
  h.agents.get(task3.peer!)!.status = "idle";
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T3" });
  const refused = await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  assert.equal(refused.ok, false);
  assert.match(refused.text, /not ready/);
  h.git(slot.path, "rm", "-q", "BROKEN");
  h.git(slot.path, "commit", "-qm", "unbreak");
  assert.equal((await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true })).ok, true);

  const closed = await h.call(sup, "supervisor", "close_lane", { lane: "L1", land: true });
  assert.equal(closed.ok, true, closed.text);
  assert.equal(h.git(h.root, "show", "main:a.txt"), "one\ntwo\nthree\nfour\n");
  assert.equal(h.ledger().slots.S0!.lane, undefined);

  const reopened = await h.call(sup, "supervisor", "open_lane", { title: "Next", outcome: "b.txt changes", acceptance: ["z"] });
  assert.equal(reopened.ok, true, reopened.text);
  assert.equal(h.ledger().lanes.L2!.slot, "S0");
  assert.equal(h.workspaces.size, 1);
  assert.deepEqual(ideCalls.filter((call) => call.path === slot.path).map((call) => call.kind), ["open", "open", "sync"]);
  assert.equal(h.git(slot.path, "branch", "--show-current").trim(), h.ledger().lanes.L2!.branch);
  h.runtime.dispose();
});

test("parallel work needs independent write sets and merges back from its own working copy", async () => {
  const h = harness("outbox-parallel.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Two files", outcome: "both change", acceptance: ["a", "b"], writeSet: ["a.txt", "b.txt"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const overlap = await h.call(lane.lead!, "lead", "start_task", { title: "A again", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"], parallel: true });
  assert.equal(overlap.ok, false);
  assert.match(overlap.text, /overlap L1-T1/);
  const serial = await h.call(lane.lead!, "lead", "start_task", { title: "Lock", goal: "g", acceptance: ["a"], owned: ["package-lock.json"], outOfScope: ["the rest of the repository"], parallel: true });
  assert.equal(serial.ok, false);
  const par = await h.call(lane.lead!, "lead", "start_task", { title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], outOfScope: ["the rest of the repository"], parallel: true });
  assert.equal(par.ok, true, par.text);
  const taskB = h.ledger().tasks["L1-T2"]!;
  assert.equal(taskB.slot, "S1");
  assert.equal(h.agents.get(taskB.peer!)!.cwd, h.ledger().slots.S1!.path);

  const taskA = h.ledger().tasks["L1-T1"]!;
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(taskA.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(taskA.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);

  h.commit(taskB.worktree!, "b.txt", "B\n");
  await h.call(taskB.peer!, "peer", "done", { outcome: "complete", summary: "b" });
  h.agents.get(taskB.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(h.git(lane.worktree!, "show", "HEAD:b.txt"), "B\n");
  assert.equal(h.ledger().slots.S1!.task, undefined);

  await h.call(sup, "supervisor", "set_project", { parallelLanes: 2 });
  const noScope = await h.call(sup, "supervisor", "open_lane", { title: "C", outcome: "c", acceptance: ["c"] });
  assert.equal(noScope.ok, false);
  const clash = await h.call(sup, "supervisor", "open_lane", { title: "C", outcome: "c", acceptance: ["c"], writeSet: ["b.txt"] });
  assert.equal(clash.ok, false);
  assert.match(clash.text, /overlaps lane L1/);
  const fine = await h.call(sup, "supervisor", "open_lane", { title: "C", outcome: "c", acceptance: ["c"], writeSet: ["c.txt"] });
  assert.equal(fine.ok, true, fine.text);
  assert.equal(h.ledger().lanes.L2!.slot, "S1");
  h.runtime.dispose();
});

test("asks reach the level above, answers come back, and a silent Peer is nudged then reported", async () => {
  const h = harness("outbox-asks.json");
  const turnEnded = (id: string, text: string) =>
    (h.runtime as unknown as { turnEnded: (p: unknown, e: unknown) => Promise<void> }).turnEnded(h.paseo, {
      agent: { id, provider: h.agents.get(id)!.provider, cwd: h.agents.get(id)!.cwd, title: h.agents.get(id)!.title, parentAgentId: null, workspaceId: null },
      turnId: `t-${id}-${Date.now()}`,
      outcome: { kind: "completed" },
      timeline: [{ type: "user_message", text: "go" }, { type: "assistant_message", text }],
    });
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Asks", outcome: "x", acceptance: ["y"] });
  const lane = h.ledger().lanes.L1!;
  await h.idle(lane.lead!);

  const asked = await h.call(lane.lead!, "lead", "ask", { kind: "question", text: "Round half up or down?", default: "half up" });
  assert.equal(asked.ok, true, asked.text);
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.at(-1)!, /ASK A1 \(question\)[\s\S]*half up/);
  assert.equal((await h.call(sup, "supervisor", "answer", { ask: "A1", text: "Half up." })).ok, true);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /ANSWER to your ask A1[\s\S]*Half up/);

  await h.call(lane.lead!, "lead", "start_task", { title: "Quiet one", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const task = h.ledger().tasks["L1-T1"]!;
  await new Promise((resolve) => setTimeout(resolve, 5));
  h.agents.get(task.peer!)!.status = "idle";
  await turnEnded(task.peer!, "I looked around.");
  await h.runtime.outbox.pump(h.paseo, task.peer!);
  assert.match(h.agents.get(task.peer!)!.sent.at(-1)!, /without calling done or ask/);
  h.runtime.outbox.turnEnded(task.peer!);
  await turnEnded(task.peer!, "Still looking.");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  h.agents.get(lane.lead!)!.status = "idle";
  h.runtime.outbox.turnEnded(lane.lead!);
  await h.runtime.outbox.pump(h.paseo, lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /SILENT L1-T1[\s\S]*Still looking/);
  h.runtime.dispose();
});

test("each project gets the agent and model its own settings choose, and the machine layer keeps the rest", async () => {
  const h = harness("outbox-per-project.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  await h.call(sup, "supervisor", "open_lane", { title: "Defaults", outcome: "a.txt changes", acceptance: ["one"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Default peer", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const onDefaults = h.agents.get(h.ledger().tasks["L1-T1"]!.peer!)!.provider;
  assert.equal(onDefaults, "sw2-peer-devin/swe-2-max");
  assert.equal(h.agents.get(lane.lead!)!.provider, "sw2-lead-claude/claude-opus-5");

  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ roles: { peer: { harness: "claude", model: "claude-opus-5" } } }));
  await h.call(h.ledger().tasks["L1-T1"]!.peer!, "peer", "done", { outcome: "complete", summary: "done" });
  h.commit(h.ledger().slots.S0!.path, "a.txt", "one\n");
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  await h.call(lane.lead!, "lead", "start_task", { title: "Claude peer", goal: "g", acceptance: ["a"], owned: ["b.txt"], outOfScope: ["the rest of the repository"] });
  const switched = h.agents.get(h.ledger().tasks["L1-T2"]!.peer!)!.provider;
  assert.equal(switched, "sw2-peer-claude/claude-opus-5");
  assert.equal(h.agents.get(lane.lead!)!.provider, "sw2-lead-claude/claude-opus-5");
  h.runtime.dispose();
});
