import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HOME = mkdtempSync(join(tmpdir(), "sw2-flow-home-"));
process.env.HOME = HOME;

const { loadKit } = await import("./kit.ts");
const { loadLedger } = await import("./ledger.ts");
const { projectOf } = await import("./project.ts");
const { Runtime } = await import("./runtime.ts");

type Fake = { id: string; provider: string; cwd: string; title: string; status: string; archivedAt: string | null; updatedAt: string; sent: string[]; prompt?: string };

function fakePaseo() {
  const agents = new Map<string, Fake>();
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
  const paseo = {
    agents: {
      ref,
      async list() {
        return { entries: [...agents.values()].map((agent) => ({ agent: { ...agent, pendingPermissions: [] } })) };
      },
    },
    workspaces: {
      async create({ source }: { source: { path: string } }) {
        return {
          agents: {
            async create(options: { config: { provider: string }; title: string; prompt: string }) {
              return ref(add(options.config.provider, source.path, options.title, "running", options.prompt));
            },
          },
        };
      },
    },
  };
  return { paseo: paseo as never, agents, add };
}

function repo(): { root: string; git: (cwd: string, ...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), "sw2-flow-repo-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "seed");
  return { root, git };
}

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), ".."));

test("a lane runs tasks through hand-back, merge, a failing gate, a conflict and landing", async () => {
  const { root, git } = repo();
  const { paseo, agents, add } = fakePaseo();
  const runtime = new Runtime(kit, join(HOME, "outbox.json"));
  const desk = runtime.desk;
  const project = projectOf(root);
  let n = 0;
  const call = async (agent: string, role: string, tool: string, args: Record<string, unknown>) =>
    desk.handle(paseo, { id: `r${++n}`, agent, role, tool, args, cwd: root, at: Date.now() });
  const idle = async (id: string) => {
    agents.get(id)!.status = "idle";
    runtime.outbox.turnEnded(id);
    await runtime.outbox.pump(paseo, id);
  };

  const sup = add("sw2-supervisor/claude-opus-5", root, "sup");
  assert.equal((await call(sup, "supervisor", "set_project", { gate: "test ! -f BROKEN" })).ok, true);
  const opened = await call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["a.txt has four"] });
  assert.equal(opened.ok, true, opened.text);
  const lane = loadLedger(project.state).lanes.L1!;
  assert.equal(agents.get(lane.lead!)!.cwd, lane.worktree);
  assert.match(agents.get(lane.lead!)!.prompt ?? "", /OWNER DIRECTIVE L1/);

  const start = async (title: string) => {
    const reply = await call(lane.lead!, "lead", "start_task", { title, goal: title, acceptance: ["done"], owned: ["a.txt", "BROKEN"] });
    assert.equal(reply.ok, true, reply.text);
    return Object.values(loadLedger(project.state).tasks).find((task) => task.title === title)!;
  };
  const finished = async (peer: string, summary: string) => {
    assert.equal((await call(peer, "peer", "done", { outcome: "complete", summary })).ok, true);
    agents.get(peer)!.status = "idle";
  };
  const commit = (cwd: string, file: string, text: string) => {
    writeFileSync(join(cwd, file), text);
    git(cwd, "add", "-A");
    git(cwd, "commit", "-qm", `edit ${file}`);
  };

  const t1 = await start("Add four");
  assert.equal(git(t1.worktree!, "branch", "--show-current").trim(), t1.branch);
  commit(t1.worktree!, "a.txt", "one\ntwo\nthree\nfour\n");
  await finished(t1.peer!, "added four");
  await idle(lane.lead!);
  assert.match(agents.get(lane.lead!)!.sent.at(-1)!, /HANDBACK L1-T1/);

  assert.equal((await call(lane.lead!, "lead", "accept", { task: t1.id })).ok, true);
  await desk.settled(project);
  assert.equal(loadLedger(project.state).tasks[t1.id]!.status, "merged");
  await idle(lane.lead!);
  assert.match(agents.get(lane.lead!)!.sent.at(-1)!, /MERGED L1-T1/);
  assert.equal(agents.get(t1.peer!)!.archivedAt !== null, true);

  const t2 = await start("Break the gate");
  commit(t2.worktree!, "BROKEN", "x\n");
  await finished(t2.peer!, "broke it");
  const before = git(lane.worktree!, "rev-parse", "HEAD").trim();
  await call(lane.lead!, "lead", "accept", { task: t2.id });
  await desk.settled(project);
  assert.equal(loadLedger(project.state).tasks[t2.id]!.status, "failed");
  assert.equal(git(lane.worktree!, "rev-parse", "HEAD").trim(), before);
  await idle(lane.lead!);
  assert.match(agents.get(lane.lead!)!.sent.join("\n"), /MERGE FAILED L1-T2/);

  const t3 = await start("Change two");
  const t4 = await start("Change two again");
  commit(t3.worktree!, "a.txt", "one\nTWO\nthree\nfour\n");
  commit(t4.worktree!, "a.txt", "one\n2\nthree\nfour\n");
  await finished(t3.peer!, "TWO");
  await finished(t4.peer!, "2");
  await call(lane.lead!, "lead", "accept", { task: t3.id });
  await call(lane.lead!, "lead", "accept", { task: t4.id });
  await desk.settled(project);
  const tasks = loadLedger(project.state).tasks;
  assert.deepEqual([tasks[t3.id]!.status, tasks[t4.id]!.status], ["merged", "rework"]);
  await idle(lane.lead!);
  assert.match(agents.get(lane.lead!)!.sent.join("\n"), /MERGE CONFLICT L1-T4[\s\S]*a\.txt/);

  await call(lane.lead!, "lead", "cut", { task: t2.id, reason: "wrong" });
  await call(lane.lead!, "lead", "cut", { task: t4.id, reason: "superseded" });
  const closed = await call(sup, "supervisor", "close_lane", { lane: "L1", land: true });
  assert.equal(closed.ok, true, closed.text);
  assert.match(closed.text, /fast-forwarded main/);
  assert.equal(git(root, "show", "main:a.txt"), "one\nTWO\nthree\nfour\n");
  runtime.dispose();
});

test("asks reach the level above, answers come back, and a silent Peer is nudged then reported", async () => {
  const { root } = repo();
  const { paseo, agents, add } = fakePaseo();
  const runtime = new Runtime(kit, join(HOME, "outbox-2.json"));
  const desk = runtime.desk;
  const project = projectOf(root);
  let n = 0;
  const call = async (agent: string, role: string, tool: string, args: Record<string, unknown>) =>
    desk.handle(paseo, { id: `q${++n}`, agent, role, tool, args, cwd: root, at: Date.now() });
  const idle = async (id: string) => {
    agents.get(id)!.status = "idle";
    runtime.outbox.turnEnded(id);
    await runtime.outbox.pump(paseo, id);
  };
  const turnEnded = (id: string, text: string) =>
    (runtime as unknown as { turnEnded: (p: unknown, e: unknown) => Promise<void> }).turnEnded(paseo, {
      agent: { id, provider: agents.get(id)!.provider, cwd: agents.get(id)!.cwd, title: agents.get(id)!.title, parentAgentId: null, workspaceId: null },
      turnId: `t${++n}`,
      outcome: { kind: "completed" },
      timeline: [{ type: "user_message", text: "go" }, { type: "assistant_message", text }],
    });

  const sup = add("sw2-supervisor/claude-opus-5", root, "sup");
  await call(sup, "supervisor", "open_lane", { title: "Asks", outcome: "x", acceptance: ["y"] });
  const lane = loadLedger(project.state).lanes.L1!;
  await idle(lane.lead!);

  const asked = await call(lane.lead!, "lead", "ask", { kind: "question", text: "Round half up or down?", default: "half up" });
  assert.equal(asked.ok, true, asked.text);
  await idle(sup);
  assert.match(agents.get(sup)!.sent.at(-1)!, /ASK A1 \(question\)[\s\S]*half up/);
  assert.equal((await call(sup, "supervisor", "answer", { ask: "A1", text: "Half up." })).ok, true);
  await idle(lane.lead!);
  assert.match(agents.get(lane.lead!)!.sent.join("\n"), /ANSWER to your ask A1[\s\S]*Half up/);
  assert.equal(loadLedger(project.state).asks.A1!.status, "answered");

  await call(lane.lead!, "lead", "start_task", { title: "Quiet one", goal: "g", acceptance: ["a"], owned: ["a.txt"] });
  const task = loadLedger(project.state).tasks["L1-T1"]!;
  await new Promise((resolve) => setTimeout(resolve, 5));
  agents.get(task.peer!)!.status = "idle";
  await turnEnded(task.peer!, "I looked around.");
  await runtime.outbox.pump(paseo, task.peer!);
  assert.match(agents.get(task.peer!)!.sent.at(-1)!, /without calling done or ask/);
  runtime.outbox.turnEnded(task.peer!);
  await turnEnded(task.peer!, "Still looking.");
  assert.equal(loadLedger(project.state).tasks["L1-T1"]!.status, "stalled");
  agents.get(lane.lead!)!.status = "idle";
  runtime.outbox.turnEnded(lane.lead!);
  await runtime.outbox.pump(paseo, lane.lead!);
  assert.match(agents.get(lane.lead!)!.sent.join("\n"), /SILENT L1-T1[\s\S]*Still looking/);
  runtime.dispose();
});
