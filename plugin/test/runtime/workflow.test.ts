import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { WatchView, WatchSeat } from "../../shared/views.ts";

const HOME = mkdtempSync(join(tmpdir(), "sw2-flow-home-"));
process.env.HOME = HOME;
globalThis.fetch = (async () => new Response("{}", { status: 503 })) as typeof fetch;

const { loadKit } = await import("../../server/catalog/kit.ts");
const { loadLedger } = await import("../../server/desk/ledger.ts");
const { projectOf } = await import("../../server/desk/project.ts");
type Project = ReturnType<typeof projectOf>;
const { Runtime } = await import("../../server/runtime/runtime.ts");
const { firstOverlap, serialHits, serialPaths, SERIAL_ONLY } = await import("../../server/core/scope.ts");
const { FakeTimeline, settle } = await import("./fake-timeline.ts");
const { readAssessments } = await import("../../server/runtime/watch/assessments.ts");

type Pending = { id: string; kind: string; name: string; title?: string; input?: Record<string, unknown> };
type Fake = {
  id: string;
  provider: string;
  cwd: string;
  title: string;
  status: string;
  archivedAt: string | null;
  updatedAt: string;
  sent: string[];
  steered: string[];
  pending: Pending[];
  answered: { requestId: string; response: { behavior: string; updatedInput?: { answers?: Record<string, string> } } }[];
  prompt?: string;
};

function fakePaseo() {
  const agents = new Map<string, Fake>();
  const workspaces = new Map<string, string>();
  const workspaceNames = new Map<string, string>();
  const archivedWorkspaces = new Set<string>();
  const timelines = new Map<string, InstanceType<typeof FakeTimeline>>();
  const timelineOf = (id: string) => {
    const found = timelines.get(id) ?? new FakeTimeline();
    timelines.set(id, found);
    return found;
  };
  let count = 0;
  const ref = (id: string) => {
    const agent = agents.get(id);
    return {
      id,
      timeline: timelineOf(id),
      get status() { return agent?.status ?? null; },
      get cwd() { return agent?.cwd ?? null; },
      get archivedAt() { return agent?.archivedAt ?? null; },
      get pendingPermissions() { return agent?.pending ?? []; },
      async refresh() {},
      current() { return agent ? { id: agent.id, provider: agent.provider, cwd: agent.cwd, title: agent.title } : null; },
      async send(text: string, options?: { activeTurnBehavior?: string }) {
        agent?.sent.push(text);
        if (options?.activeTurnBehavior === "steer") agent?.steered.push(text);
      },
      async respondToPermission({ requestId, response }: Fake["answered"][number]) {
        const at = agent?.pending.findIndex((request) => request.id === requestId) ?? -1;
        if (!agent || at < 0) throw new Error(`No pending permission request with id '${requestId}'`);
        agent.pending.splice(at, 1);
        agent.answered.push({ requestId, response });
      },
      async archive() { if (agent) Object.assign(agent, { archivedAt: new Date().toISOString(), status: "closed" }); },
    };
  };
  const add = (provider: string, cwd: string, title: string, status = "idle", prompt?: string) => {
    const id = `agent-${++count}`;
    agents.set(id, { id, provider, cwd, title, status, archivedAt: null, updatedAt: new Date().toISOString(), sent: [], steered: [], pending: [], answered: [], prompt });
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
      // The daemon caps a page at 200 rows whether or not one was asked for, and reports the rest
      // through pageInfo. A fake that answers everything cannot show what reading one page costs.
      async list(options?: { page?: { limit?: number; cursor?: string } }) {
        const all = [...agents.values()].map((agent) => ({ agent: { ...agent, pendingPermissions: agent.pending } }));
        const from = Number(options?.page?.cursor ?? 0);
        const limit = options?.page?.limit ?? 200;
        const next = from + limit;
        return {
          entries: all.slice(from, next),
          pageInfo: { hasMore: next < all.length, nextCursor: next < all.length ? String(next) : null, prevCursor: null },
        };
      },
    },
    workspaces: {
      async create({ title, source }: { title?: string; source: { path: string } }) {
        const id = `ws-${workspaces.size + 1}`;
        workspaces.set(id, source.path);
        if (title) workspaceNames.set(id, title);
        return workspace(id);
      },
      async list() {
        return {
          entries: [...workspaces.keys()].map((id) => ({ id, name: workspaceNames.get(id) ?? "", archivingAt: archivedWorkspaces.has(id) ? new Date().toISOString() : null })),
          pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
        };
      },
      async archive(id: string) {
        archivedWorkspaces.add(typeof id === "string" ? id : (id as { id: string }).id);
        return { archivedAt: new Date().toISOString() };
      },
      async owned(prefix: string) {
        return [...workspaces.keys()]
          .filter((id) => !archivedWorkspaces.has(id))
          .map((id) => ({ id, name: workspaceNames.get(id) ?? "" }))
          .filter((entry) => entry.name === prefix || entry.name.startsWith(`${prefix} `));
      },
      ref: workspace,
    },
  };
  return { paseo: paseo as never, agents, add, workspaces, workspaceNames, archivedWorkspaces, timelineOf };
}

function repo(): { root: string; git: (cwd: string, ...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), "sw2-flow-repo-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(root, "b.txt"), "bee\n");
  // A real one, because the desk now reads the serial-only rules against the files that exist.
  writeFileSync(join(root, "package-lock.json"), "{}\n");
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
  // The key is the watch's switch, so a test about the watch has to set one: without it nothing here
  // is followed at all. The endpoint is unreachable above unless a test asks for an answer, which is
  // the state these tests are really in — the watch on, reading turns in code, the sensor silent.
  writeFileSync(join(state, "settings.json"), JSON.stringify({ sensor: { key: "sk-or-harness" }, mcp: { "intellij-index": { enabled: true }, "code-search": { enabled: true }, context7: { enabled: true } } }));
  const { paseo, agents, add, workspaces, workspaceNames, archivedWorkspaces, timelineOf } = fakePaseo();
  const runtime = new Runtime(kit, { outboxFile: join(HOME, outbox), paseo, codeIndex: (proxy: { id: string; gitExclude?: string[] }) => ({ ...ide, id: proxy.id, gitExclude: proxy.gitExclude ?? [] }), reloadDaemon: async () => true });
  const project = projectOf(root);
  let n = 0;
  // `where` is the working copy the call comes from: a second project on one daemon is an arrangement
  // the desk has to hold, and several of its keys turned out to be shared between them.
  const call = async (agent: string, role: string, tool: string, args: Record<string, unknown>, where = root) =>
    runtime.desk.handle({ id: `${outbox}-${++n}`, agent, role, tool, args, cwd: where, at: Date.now() });
  const idle = async (id: string) => {
    agents.get(id)!.status = "idle";
    runtime.outbox.turnEnded(id);
    await runtime.outbox.pump(id);
  };
  const commit = (cwd: string, file: string, text: string) => {
    writeFileSync(join(cwd, file), text);
    git(cwd, "add", "-A");
    git(cwd, "commit", "-qm", `edit ${file}`);
  };
  const ledger = (of: Project = project) => loadLedger(of.state);
  const tick = (now?: number) => (runtime as unknown as { patrol: { tick(now?: number): Promise<void> } }).patrol.tick(now);
  // Paseo fires a turn start before a turn end, and what the desk heard from a seat "this turn" is
  // measured from it; without one, every turn is measured from half an hour ago.
  const beginTurn = (id: string) => (runtime as unknown as { turnStarted(agentId: string): void }).turnStarted(id);
  // Paseo hands this hook everything it has ever stored for the seat, not the turn that ended: its
  // timeline store is append-only and `getItems` returns all of it. A fresh one-turn array per call
  // was the wrong shape, and it hid a reader that found the same failed call at every later turn.
  const told = new Map<string, unknown[]>();
  const endTurn = (id: string, text: string, ...calls: unknown[]) => {
    const timeline = told.get(id) ?? [];
    timeline.push({ type: "user_message", text: "go" }, ...calls, { type: "assistant_message", text });
    told.set(id, timeline);
    return (runtime as unknown as { turnEnded: (event: unknown) => Promise<void> }).turnEnded({
      agent: { id, provider: agents.get(id)!.provider, cwd: agents.get(id)!.cwd, title: agents.get(id)!.title, parentAgentId: null, workspaceId: null },
      turnId: `t-${id}-${Date.now()}`,
      outcome: { kind: "completed" },
      timeline: [...timeline],
    });
  };
  const permission = (id: string, request: Pending) =>
    (runtime as unknown as { permissionRequested: (event: unknown) => Promise<void> }).permissionRequested({
      agent: { id, provider: agents.get(id)!.provider, cwd: agents.get(id)!.cwd, title: agents.get(id)!.title, parentAgentId: null, workspaceId: null },
      request,
    });
  return { root, git, paseo, agents, add, workspaces, workspaceNames, archivedWorkspaces, runtime, project, call, idle, commit, ledger, endTurn, tick, beginTurn, permission, timelineOf };
}

test("write sets overlap by path prefix and glob, and serial-only paths are caught", () => {
  assert.equal(firstOverlap(["src/pages/"], ["src/api/"]), undefined);
  assert.ok(firstOverlap(["src/"], ["src/api/users.ts"]));
  assert.ok(firstOverlap(["src/**/*.ts"], ["src/api/users.ts"]));
  assert.ok(firstOverlap(["**/*.ts"], ["lib/x.ts"]));
  assert.equal(firstOverlap(["**/*.ts"], ["src/app.py"]), undefined, "a glob at the front does not mean it overlaps everything");
  // Two lanes share a working copy on the strength of this answer, so a wildcard on both sides has
  // to be decided rather than sampled: each of these pairs is satisfied by one real path.
  assert.ok(firstOverlap(["src/**/*.ts"], ["**/*.test.ts"]), "src/pricing.test.ts matches both");
  assert.ok(firstOverlap(["src/**"], ["**/*.ts"]), "src/a.ts matches both");
  assert.ok(firstOverlap(["src/**/*.ts"], ["**/api/*.ts"]), "src/api/x.ts matches both");
  assert.ok(firstOverlap(["server/**"], ["**/ledger.ts"]), "server/ledger.ts matches both");
  assert.equal(firstOverlap(["src/**/*.ts"], ["docs/**/*.md"]), undefined, "and nothing satisfies these");
  // Inside one segment the same trap waits: a witness made up from either pattern matches neither.
  assert.ok(firstOverlap(["src/*.ts"], ["src/app.*"]), "src/app.ts satisfies both");
  assert.ok(firstOverlap(["app/a*.tsx"], ["app/*b.tsx"]), "app/ab.tsx satisfies both");
  assert.ok(firstOverlap(["src/?.ts"], ["src/a.*"]), "src/a.ts satisfies both");
  assert.equal(firstOverlap(["src/*.ts"], ["src/*.py"]), undefined, "and one extension cannot be the other");
  // The rules are globs and so are write sets, so they are resolved against the repository first:
  // a lane claiming a subtree is held back for the lock file that is really in it, not for one that
  // a glob says might be, or every lane claiming a subtree would wait for every other.
  const tracked = ["package-lock.json", "db/migrations/0001.sql", "src/app.ts", "Assets/Scenes/Main.unity"];
  const serial = serialPaths(tracked, SERIAL_ONLY);
  assert.deepEqual(serial, ["Assets/Scenes/Main.unity", "db/migrations/", "package-lock.json"], "the migration's directory is reserved, so the next one counts before it is written");
  assert.deepEqual(serialHits(["app/**"], serial), [], "a tree with none of them in it is not held back for them");
  assert.deepEqual(serialHits(["src/**", "package-lock.json"], serial), ["package-lock.json"]);
  assert.deepEqual(serialHits(["db/**"], serial), ["db/**"], "and a tree that does hold one is");
  // `**/migrations/**` stands for whole segments. Rendered without the boundary it matched any
  // segment merely ending in the name, so a directory nobody's rule named was made serial and two
  // lanes that never touch a migration were refused for overlapping.
  assert.deepEqual(serialPaths(["server/db_migrations/0001.sql"], SERIAL_ONLY), []);
  assert.deepEqual(serialPaths(["db/migrations/0001.sql"], SERIAL_ONLY), ["db/migrations/"]);
  assert.deepEqual(serialHits(["db/migrations/0002.sql"], serial), ["db/migrations/0002.sql"], "including a migration nobody has written yet");
  assert.deepEqual(serialHits(["Assets/Scenes/Main.unity"], serial), ["Assets/Scenes/Main.unity"]);
});

test("a lane works serially in the project's own copy and hands it back on its base branch", async () => {
  const h = harness("outbox-serial.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "test ! -f BROKEN" });
  const noLimits = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"] });
  assert.equal(noLimits.ok, false);
  assert.match(noLimits.text, /out of scope/);

  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else in the repository"] });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  const slot = { path: h.project.root };
  assert.deepEqual(Object.keys(h.ledger().slots), [], "a lane opened without isolate takes the project's own copy, not a new one");
  assert.equal(h.agents.get(lane.lead!)!.cwd, slot.path);
  assert.equal(h.git(slot.path, "branch", "--show-current").trim(), lane.branch);
  assert.deepEqual(ideCalls.filter((call) => call.path === slot.path), [
    { kind: "open", path: slot.path },
    { kind: "sync", path: slot.path },
  ]);
  assert.match(h.git(h.root, "rev-parse", "--git-path", "info/exclude").trim() && readFileSync(join(h.root, ".git", "info", "exclude"), "utf-8"), /^\.idea\/$/m);
  assert.equal(h.git(slot.path, "status", "--porcelain"), "");

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
  // A red gate is evidence carried in the report, not a gag on the Lead: acceptance is the Lead's to claim and the Supervisor's to judge.
  const onRed = await h.call(lane.lead!, "lead", "report", { summary: "the lane is done", ready: true });
  assert.equal(onRed.ok, true, onRed.text);
  h.git(slot.path, "rm", "-q", "BROKEN");
  h.git(slot.path, "commit", "-qm", "unbreak");
  assert.equal((await h.call(lane.lead!, "lead", "report", { summary: "done, and green this time", ready: true })).ok, true);
  await h.idle(sup);
  const reports = h.agents.get(sup)!.sent.join("\n");
  assert.match(reports, /Gate: .*failed with exit/, "the red gate has to reach the Supervisor, not stop the Lead from speaking");
  assert.match(reports, /Gate: .*passed on the lane branch/);

  const closed = await h.call(sup, "supervisor", "close_lane", { lane: "L1", land: true });
  assert.equal(closed.ok, true, closed.text);
  assert.equal(h.git(h.root, "show", "main:a.txt"), "one\ntwo\nthree\nfour\n");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), lane.branch, "the Lead is mid-turn, and switching the copy under it would put its next commit on main");
  assert.match(closed.text, /put away once/);
  h.agents.get(lane.lead!)!.status = "idle";
  await h.endTurn(lane.lead!, "closing up");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main", "once the Lead stops, the project's copy is back on its base branch");

  const reopened = await h.call(sup, "supervisor", "open_lane", { title: "Next", outcome: "b.txt changes", acceptance: ["z"], outOfScope: ["anything else in the repository"] });
  assert.equal(reopened.ok, true, reopened.text);
  assert.equal(h.ledger().lanes.L2!.slot, undefined, "the next lane works in place too, so nothing is created to reuse");
  assert.equal(h.workspaces.size, 1);
  assert.deepEqual(ideCalls.filter((call) => call.path === slot.path).map((call) => call.kind), ["open", "sync", "open", "sync"]);
  assert.equal(h.git(slot.path, "branch", "--show-current").trim(), h.ledger().lanes.L2!.branch);
  h.runtime.dispose();
});

test("a lane that fails after taking the project's own copy gives it back", async () => {
  const h = harness("outbox-inplace.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const before = h.git(h.project.root, "branch", "--show-current").trim();

  // A role that cannot lead is refused after `inPlace` has already switched the owner's repository
  // onto the lane branch. openLane cleans up by slot id, which a lane in the project's own copy does
  // not have, so this used to close the lane and walk away from the checkout it had just moved.
  const refused = await h.call(sup, "supervisor", "open_lane", {
    title: "Numbers",
    outcome: "a.txt gains words",
    acceptance: ["four"],
    outOfScope: ["anything else in the repository"],
    role: "peer",
  });
  assert.equal(refused.ok, false, refused.text);
  const lane = h.ledger().lanes.L1!;
  assert.equal(lane.status, "closed");
  assert.equal(h.git(h.project.root, "branch", "--show-current").trim(), before, "the owner's repository is back where it was");
  assert.equal(h.git(h.project.root, "branch", "--list", lane.branch).trim(), "", "and the branch the lane made, which holds nothing, is gone");
  h.runtime.dispose();
});

test("a gate the owner switched off is still off when the next lane opens", async () => {
  const h = harness("outbox-gate.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  writeFileSync(join(h.project.root, "package.json"), JSON.stringify({ scripts: { test: "echo ran" } }));
  h.git(h.project.root, "add", "-A");
  h.git(h.project.root, "commit", "-qm", "a package");

  assert.match((await h.call(sup, "supervisor", "set_project", { gate: "" })).text, /gate none/);
  // "The owner switched it off" and "nobody has ever set one" were the same stored value, and
  // open_lane seeds a gate whenever it reads the second — so the next lane detected `npm test` from
  // the repository, wrote it back over the answer, and told the Lead it runs before anything lands.
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"] });
  assert.equal(opened.ok, true, opened.text);
  assert.match(opened.text, /Gate: none set, by this project's own choice/, opened.text);
  assert.match((await h.call(sup, "supervisor", "set_project", {})).text, /gate none/);
  h.runtime.dispose();
});

test("a lane in the project's own copy whose base moved waits for a seat mid-turn there, then lands", async () => {
  const h = harness("outbox-moved.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"] });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  writeFileSync(join(h.project.root, "a.txt"), "one\ntwo\nthree\nfour\n");
  h.git(h.project.root, "add", "-A");
  h.git(h.project.root, "commit", "-qm", "four");

  // main moves on while the lane runs, so landing is a merge — and a merge needs a working copy
  // standing on main. The desk put the project's own copy on the lane branch to open the lane, and
  // then refused to land over exactly that, twenty-five lines before putting it back.
  const side = join(mkdtempSync(join(tmpdir(), "sw2-moved-")), "wt");
  h.git(h.project.root, "worktree", "add", "-q", "-b", "side", side, "main");
  h.git(side, "commit", "-qm", "moved", "--allow-empty");
  h.git(h.project.root, "branch", "-f", "main", "side");
  h.git(h.project.root, "worktree", "remove", "--force", side);

  // While the Lead is mid-turn in that copy, it is not switched under it: its next commit would land
  // on main itself. The first version of this guard asked a set that fills only once an archive has
  // found a seat running, before anything had been archived — so it never held, and this test, whose
  // Lead was running the whole time, passed because of that.
  const reports = await h.call(sup, "supervisor", "close_lane", { lane: "L1", land: true });
  assert.equal(reports.ok, false, reports.text);
  assert.match(reports.text, /a seat is mid-turn there/);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), lane.branch, "the copy under a running seat stays where the seat is");
  assert.doesNotMatch(h.git(h.root, "show", "main:a.txt"), /four/);
  // And the lane is still open, so the landing waits for the turn instead of being lost: closed first,
  // a lane cannot be closed again, and the Supervisor's decision could never be carried out.
  assert.equal(h.ledger().lanes.L1!.status, "open");
  h.agents.get(lane.lead!)!.status = "idle";
  const landed = await h.call(sup, "supervisor", "close_lane", { lane: "L1", land: true });
  assert.match(landed.text, /merged .* into main/, landed.text);
  h.runtime.dispose();
});

test("a lane in the project's own copy lands after its base moved, once nobody is writing there", async () => {
  const h = harness("outbox-moved-idle.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"] });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  writeFileSync(join(h.project.root, "a.txt"), "one\ntwo\nthree\nfour\n");
  h.git(h.project.root, "add", "-A");
  h.git(h.project.root, "commit", "-qm", "four");
  const side = join(mkdtempSync(join(tmpdir(), "sw2-moved-")), "wt");
  h.git(h.project.root, "worktree", "add", "-q", "-b", "side", side, "main");
  h.git(side, "commit", "-qm", "moved", "--allow-empty");
  h.git(h.project.root, "branch", "-f", "main", "side");
  h.git(h.project.root, "worktree", "remove", "--force", side);

  // The desk put the project's own copy on the lane branch to open the lane, and then refused to land
  // over exactly that. With the Lead stopped, the copy may go back to main first.
  h.agents.get(lane.lead!)!.status = "idle";
  const closed = await h.call(sup, "supervisor", "close_lane", { lane: "L1", land: true });
  assert.equal(closed.ok, true, closed.text);
  assert.match(closed.text, /merged .* into main/, closed.text);
  assert.match(h.git(h.root, "show", "main:a.txt"), /four/);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
  h.runtime.dispose();
});

test("parallel work needs independent write sets and merges back from its own working copy", async () => {
  const h = harness("outbox-parallel.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Two files", outcome: "both change", acceptance: ["a", "b"], outOfScope: ["anything else in the repository"], writeSet: ["a.txt", "b.txt"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const overlap = await h.call(lane.lead!, "lead", "start_task", { title: "A again", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"], parallel: true });
  assert.equal(overlap.ok, false);
  assert.match(overlap.text, /overlap L1-T1/);
  const serial = await h.call(lane.lead!, "lead", "start_task", { title: "Lock", goal: "g", acceptance: ["a"], owned: ["package-lock.json"], outOfScope: ["the rest of the repository"], parallel: true });
  assert.equal(serial.ok, false, "the lock file is really in this repository, so a parallel task may not own it");
  const par = await h.call(lane.lead!, "lead", "start_task", { title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], outOfScope: ["the rest of the repository"], parallel: true });
  assert.equal(par.ok, true, par.text);
  const taskB = h.ledger().tasks["L1-T2"]!;
  assert.equal(taskB.slot, "S0", "the lane itself is in place, so the parallel task takes the first working copy the desk makes");
  assert.equal(h.agents.get(taskB.peer!)!.cwd, h.ledger().slots.S0!.path);

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
  assert.deepEqual(Object.keys(h.ledger().slots), [], "the copy a parallel task opened is torn down once its work is in");

  const clash = await h.call(sup, "supervisor", "open_lane", { title: "C", outcome: "c", acceptance: ["c"], outOfScope: ["anything else in the repository"], writeSet: ["b.txt"] });
  assert.equal(clash.ok, false);
  assert.match(clash.text, /overlaps lane L1/, "two lanes that declared the same file are one lane, whichever copy each of them writes in");
  const fine = await h.call(sup, "supervisor", "open_lane", { title: "C", outcome: "c", acceptance: ["c"], outOfScope: ["anything else in the repository"], writeSet: ["c.txt"] });
  assert.equal(fine.ok, true, fine.text);
  assert.ok(h.ledger().lanes.L2!.slot, "L1 is writing in the project's own copy, so the next lane is given one instead of switching the branch under it");
  h.runtime.dispose();
});

test("asks reach the level above, answers come back, and a silent Peer is nudged then reported", async () => {
  const h = harness("outbox-asks.json");
  const turnEnded = h.endTurn;
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Asks", outcome: "x", acceptance: ["y"], outOfScope: ["anything else in the repository"] });
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
  await h.runtime.outbox.pump(task.peer!);
  assert.match(h.agents.get(task.peer!)!.sent.at(-1)!, /without calling done or ask/);
  h.runtime.outbox.turnEnded(task.peer!);
  await turnEnded(task.peer!, "Still looking.");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  h.agents.get(lane.lead!)!.status = "idle";
  h.runtime.outbox.turnEnded(lane.lead!);
  await h.runtime.outbox.pump(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /SILENT L1-T1[\s\S]*Still looking/);
  h.runtime.dispose();
});

test("a working Peer past the first page of agents is not read as gone", async () => {
  const h = harness("outbox-paged.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  // A long-lived daemon: plenty of other agents, more recently active than the Peer about to start.
  for (let index = 0; index < 205; index++) h.add("sw2-supervisor-claude/claude-opus-5", h.root, `other-${index}`);

  await h.call(sup, "supervisor", "open_lane", { title: "Busy machine", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const task = h.ledger().tasks["L1-T1"]!;
  assert.equal(h.agents.size > 200, true, "the seats this lane needs are past the first page");

  await h.tick(Date.now());
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "a seat the desk cannot see on one page is not a seat that is gone");
  await h.idle(lane.lead!);
  assert.doesNotMatch(h.agents.get(lane.lead!)!.sent.join("\n"), /was closed or archived/, "and its Lead is not told a working Peer was closed");
  assert.equal(task.peer !== undefined, true);
  h.runtime.dispose();
});

test("a call that runs longer than a seat can wait is answered by mail, and calling it again does not run it twice", async () => {
  const h = harness("outbox-later.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "sleep 1" });
  await h.call(sup, "supervisor", "open_lane", { title: "Slow", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  const request = { id: "r1", agent: lane.lead!, role: "lead", tool: "report", args: { summary: "ready to land", ready: true }, cwd: h.root, at: Date.now() };

  // The seat's bridge waits five minutes; the gate this runs is allowed thirty. Past the five the
  // bridge told the seat to call again, and the desk served the second call beside the first: a
  // second gate in the same working copy, and for close_lane a second landing.
  const [first, again] = await Promise.all([h.runtime.desk.answer(request, 100), h.runtime.desk.answer({ ...request, id: "r2" }, 100)]);
  assert.match(first.text, /still working on report/);
  assert.match(again.text, /already running/);
  await Promise.all([...(h.runtime.desk as unknown as { running: Map<string, { reply: Promise<unknown> }> }).running.values()].map((entry) => entry.reply));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(readdirSync(join(h.project.state, "gates")).filter((name) => name.startsWith("L1-")).length, 1, "one gate ran, not two");
  await h.idle(lane.lead!);
  const told = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.equal(told.split("ANSWER to your report call").length - 1, 1, "and the answer came once, as mail");
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /REPORT L1/);
  h.runtime.dispose();
});

test("a hand-back whose gate outlasts the call is not read as a silent turn", async () => {
  const h = harness("outbox-slowdone.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "sleep 1", gateOn: "task" });
  await h.call(sup, "supervisor", "open_lane", { title: "Slow", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.commit(lane.worktree!, "a.txt", "A\n");

  // The gate runs inside `done`; past what a call can wait, the Peer is told the answer comes by mail
  // and to end its turn. It does — and that turn was then read as one that never called done: the
  // Peer was nudged to call it again, which would have run a second gate beside the first.
  h.beginTurn(peer);
  const reply = await h.runtime.desk.answer({ id: "d1", agent: peer, role: "peer", tool: "done", args: { outcome: "complete", summary: "done" }, cwd: h.root, at: Date.now() }, 100);
  assert.match(reply.text, /still working on done/);
  h.agents.get(peer)!.status = "idle";
  await h.endTurn(peer, "handed back, ending my turn as told");
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 0, "a call still being worked on is not silence");
  assert.doesNotMatch(h.agents.get(peer)!.sent.join("\n"), /without calling done or ask/);

  await Promise.all([...(h.runtime.desk as unknown as { running: Map<string, { reply: Promise<unknown> }> }).running.values()].map((entry) => entry.reply));
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "done");
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /Gate: sleep 1 passed/);
  h.runtime.dispose();
});

test("a task stalled because its Peer is gone holds no copy, and an ask to a gone reader goes to whoever supervises now", async () => {
  const h = harness("outbox-goneholder.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Gone", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  Object.assign(h.agents.get(peer)!, { archivedAt: new Date().toISOString(), status: "closed" });
  await h.tick(Date.now());
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");

  // Nobody is writing in the copy any more. Held as if somebody were, the Lead was told to wait for a
  // hand-back that could not come, and the only way out was cut, which resets the Peer's work away.
  const next = await h.call(lane.lead!, "lead", "start_task", { title: "More", goal: "g", acceptance: ["b"], owned: ["b.txt"], outOfScope: ["the rest of the repository"] });
  assert.equal(next.ok, true, next.text);

  // A Lead's own ask to a Supervisor that has since gone: never reminded, never escalated, and the
  // Supervisor who sat down afterwards was never told of it.
  assert.equal((await h.call(lane.lead!, "lead", "ask", { kind: "question", text: "Keep the old endpoint?", default: "keep it" })).ok, true);
  Object.assign(h.agents.get(sup)!, { archivedAt: new Date().toISOString(), status: "closed" });
  const back = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup-2");
  await h.tick(Date.now() + 16 * 60_000);
  await h.idle(back);
  assert.match(h.agents.get(back)!.sent.join("\n"), /Keep the old endpoint\?/);
  assert.equal(Object.values(h.ledger().asks).find((ask) => ask.text.startsWith("Keep the old endpoint"))!.to, back);
  h.runtime.dispose();
});

test("an escalation with nobody supervising seated waits for one instead of being marked sent", async () => {
  const h = harness("outbox-escalate.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Asks", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  assert.equal((await h.call(peer, "peer", "ask", { question: "Round half up or down?", tried: "read the spec" })).ok, true);
  h.agents.get(lane.lead!)!.status = "idle";
  Object.assign(h.agents.get(sup)!, { archivedAt: new Date().toISOString(), status: "closed" });

  // Two reminders to the Lead, then the escalation. With the only Supervisor archived there is nobody
  // to escalate to; marking it escalated anyway meant it was never sent, even once one sat down.
  const start = Date.now();
  for (const minutes of [16, 32, 48]) await h.tick(start + minutes * 60_000);
  const ask = Object.values(h.ledger().asks)[0]!;
  assert.equal(ask.escalated ?? false, false, "nobody received it, so it is not recorded as escalated");

  const back = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup-2");
  await h.tick(start + 64 * 60_000);
  await h.idle(back);
  assert.equal(Object.values(h.ledger().asks)[0]!.escalated, true);
  assert.match(h.agents.get(back)!.sent.join("\n"), /Round half up or down\?/, "and the Supervisor who came back is the one told");
  h.runtime.dispose();
});

test("a stalled task still holds its working copy, and runs again once its Peer is heard from", async () => {
  const h = harness("outbox-stalled.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Quiet", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.agents.get(peer)!.status = "idle";
  for (const text of ["reading", "still reading"]) {
    h.runtime.outbox.turnEnded(peer);
    await new Promise((resolve) => setTimeout(resolve, 3));
    h.beginTurn(peer);
    await h.endTurn(peer, text);
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  assert.match(h.agents.get(peer)!.prompt ?? "", /Your task started from [0-9a-f]{40}/, "the brief names where the task began, which is BASE for its checks");

  // Its Peer is still seated in the lane's copy, and the Lead is told to message it there. Read as not
  // holding the copy, a stalled task let a second Peer be seated in the same checkout.
  const second = await h.call(lane.lead!, "lead", "start_task", { title: "More", goal: "g", acceptance: ["b"], owned: ["b.txt"], outOfScope: ["the rest of the repository"] });
  assert.equal(second.ok, false, second.text);

  // And once it is working again it is running. Nothing set it back before, so the patrol's gone-Peer
  // and idle-lane checks went on ignoring a Peer that was plainly there.
  h.runtime.outbox.turnEnded(peer);
  await new Promise((resolve) => setTimeout(resolve, 3));
  h.beginTurn(peer);
  assert.equal((await h.call(peer, "peer", "ask", { question: "Which file first?", tried: "read both" })).ok, true);
  await h.endTurn(peer, "asked");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running");
  h.runtime.dispose();
});

test("a Peer that asked is not stalled on its next quiet turn, and a repeated rework is not called sent", async () => {
  const h = harness("outbox-silent.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Quiet", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Work", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const task = h.ledger().tasks["L1-T1"]!;
  const peer = task.peer!;

  // Turn one: still working, nothing said. The desk nudges it.
  h.agents.get(peer)!.status = "idle";
  h.beginTurn(peer);
  await h.endTurn(peer, "still reading");
  await h.runtime.outbox.pump(peer);
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 1);
  assert.match(h.agents.get(peer)!.sent.at(-1)!, /without calling done or ask/);

  // Turn two: it hits a question and asks. That is the opposite of silence. (Real turns are seconds
  // apart; what the desk heard "this turn" is measured in milliseconds, so the test has to move.)
  h.runtime.outbox.turnEnded(peer);
  await new Promise((resolve) => setTimeout(resolve, 3));
  h.beginTurn(peer);
  assert.equal((await h.call(peer, "peer", "ask", { question: "Round half up or down?", tried: "read the spec" })).ok, true);
  await h.endTurn(peer, "asked and waiting");
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 0, "the count is of consecutive quiet turns, not a lifetime tally");

  // Turn three: applying the answer, quiet again. One quiet turn is a nudge, not a stall.
  h.runtime.outbox.turnEnded(peer);
  await new Promise((resolve) => setTimeout(resolve, 3));
  h.beginTurn(peer);
  await h.endTurn(peer, "applying it");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "a Peer that asked in between has not gone silent twice");
  assert.equal(h.ledger().tasks["L1-T1"]!.silent, 1);

  // And the same instruction twice: the letter is keyed by the event, so the second one really goes.
  const first = await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "Commit your work." });
  assert.equal(first.ok, true, first.text);
  const again = await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "Commit your work." });
  assert.equal(again.ok, true, "a Lead repeating itself is a second instruction, not a double post");
  h.runtime.outbox.turnEnded(peer);
  await h.runtime.outbox.pump(peer);
  const told = h.agents.get(peer)!.sent.join("\n");
  assert.equal(told.match(/Commit your work/g)?.length, 2, "both went; keyed by its words, the second was dropped and the Lead was told it was sent");
  h.runtime.dispose();
});

test("each project gets the agent and model its own settings choose, and the machine layer keeps the rest", async () => {
  const h = harness("outbox-per-project.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  await h.call(sup, "supervisor", "open_lane", { title: "Defaults", outcome: "a.txt changes", acceptance: ["one"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Default peer", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const onDefaults = h.agents.get(h.ledger().tasks["L1-T1"]!.peer!)!.provider;
  assert.equal(onDefaults, "sw2-peer-devin/swe-2-max");
  assert.equal(h.agents.get(lane.lead!)!.provider, "sw2-lead-claude/claude-opus-5");

  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ roles: { peer: { harness: "claude", model: "claude-opus-5" } } }));
  await h.call(h.ledger().tasks["L1-T1"]!.peer!, "peer", "done", { outcome: "complete", summary: "done" });
  h.commit(h.root, "a.txt", "one\n");
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  await h.call(lane.lead!, "lead", "start_task", { title: "Claude peer", goal: "g", acceptance: ["a"], owned: ["b.txt"], outOfScope: ["the rest of the repository"] });
  const switched = h.agents.get(h.ledger().tasks["L1-T2"]!.peer!)!.provider;
  assert.equal(switched, "sw2-peer-claude/claude-opus-5");
  assert.equal(h.agents.get(lane.lead!)!.provider, "sw2-lead-claude/claude-opus-5");
  h.runtime.dispose();
});




test("what the desk opened and nothing holds any more is swept away without being asked", async () => {
  const h = harness("outbox-sweep.json");
  const tick = h.tick;
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Swept", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });

  const ws = h.paseo as unknown as { workspaces: { create(options: { title: string; source: { kind: string; path: string } }): Promise<{ id: string }> } };
  const orphan = await ws.workspaces.create({ title: `${h.project.slug} S9`, source: { kind: "directory", path: h.root } });
  const inPlace = [...h.workspaceNames.entries()].find(([, name]) => name === h.project.slug)![0];
  assert.equal(h.archivedWorkspaces.has(orphan.id), false, "the orphan starts out live");

  await tick();

  assert.equal(h.archivedWorkspaces.has(orphan.id), true, "a working copy the ledger no longer holds is put away by the desk, not by a human with a shell");
  assert.equal(h.archivedWorkspaces.has(inPlace), false, "the copy the open lane is working in is left alone");
  h.runtime.dispose();
});

test("one workspace carries a whole project, and the desk puts it away when the project goes quiet", async () => {
  const h = harness("outbox-quiet.json");
  const tick = h.tick;
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Quiet", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;

  const live = () =>
    [...h.workspaceNames.entries()].filter(([id, name]) => (name === h.project.slug || name.startsWith(`${h.project.slug} `)) && !h.archivedWorkspaces.has(id));
  assert.equal(live().length, 1, "a lane takes the project's one working copy rather than opening one of its own");

  await h.call(sup, "supervisor", "close_lane", { lane: "L1", land: false, reason: "done" });
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  h.agents.get(sup)!.archivedAt = new Date().toISOString();
  await tick();

  assert.equal(live().length, 0, "with the work finished and nobody seated, the desk takes back what it opened instead of leaving it for a human to delete");
  h.runtime.dispose();
});

test("a lane that declared no write set does not lock the project to one lane: the next lane takes a copy of its own", async () => {
  const h = harness("outbox-lockout.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };

  // The first lane is allowed to open with no write set, and takes the project's own copy.
  const first = await h.call(sup, "supervisor", "open_lane", { title: "Authorization", outcome: "roles gate the api", acceptance: ["a"], ...scope });
  assert.equal(first.ok, true, first.text);

  // The next lane is not refused for what the first one did not declare. One checkout is one branch,
  // so it gets a copy of its own rather than switching the branch under the first lane's Lead.
  const next = await h.call(sup, "supervisor", "open_lane", { title: "Authentication", outcome: "sessions exist", acceptance: ["a"], writeSet: ["src/auth/**"], ...scope });
  assert.equal(next.ok, true, next.text);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), h.ledger().lanes.L1!.branch, "the project's own copy stays on the lane it is carrying");

  // The DETOUR of the concept: a hole found mid-lane gets its own Lead, and a copy of its own too.
  const detour = await h.call(sup, "supervisor", "open_lane", { title: "Sessions", outcome: "sessions last a day", acceptance: ["a"], isolate: true, ...scope });
  assert.equal(detour.ok, true, detour.text);
  const lanes = h.ledger().lanes;
  assert.equal(Object.values(lanes).filter((lane) => lane.status === "open").length, 3);
  const where = [lanes.L1!, lanes.L2!, lanes.L3!].map((lane) => h.agents.get(lane.lead!)!.cwd);
  assert.equal(new Set(where).size, 3, "no two Leads are left writing in one checkout");
});

test("a ledger the desk cannot read is not written over, and the seat is told why", async () => {
  const h = harness("outbox-badledger.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Real work", outcome: "x", acceptance: ["a"], ...scope });
  assert.ok(h.ledger().lanes.L1, "there is something on record to lose");

  // Whatever put it there — a half-written disk, an editor, a newer plugin's version — what reads as
  // nothing reads exactly like a project that has not started yet.
  const file = join(h.project.state, "ledger.json");
  const kept = '{ "version": 1, "lanes": ';
  writeFileSync(file, kept);

  const refused = await h.call(sup, "supervisor", "open_lane", { title: "After", outcome: "y", acceptance: ["a"], ...scope });
  assert.equal(refused.ok, false);
  assert.match(refused.text, /could not be read/, "the seat is told, rather than getting a lane in a project that forgot the first one");
  assert.equal(readFileSync(file, "utf-8"), kept, "an empty ledger written over it forgets every lane, task and working copy on record");

  // And reading is held to the same rule as writing. The status tool answered with an empty project —
  // "No open lanes." — which is exactly what the refusal above exists to stop anyone believing.
  const status = await h.call(sup, "supervisor", "status", {});
  assert.equal(status.ok, false);
  assert.match(status.text, /could not be read/);
  assert.doesNotMatch(status.text, /No open lanes/);
  h.runtime.dispose();
});

test("a detour hands back to the lane that was waiting on it, and cannot be opened for a lane that is not", async () => {
  const h = harness("outbox-detour.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Checkout", outcome: "an order can be paid for", acceptance: ["a"], ...scope });
  const waiting = h.ledger().lanes.L1!;

  const nowhere = await h.call(sup, "supervisor", "open_lane", { title: "Money type", outcome: "money is not a float", acceptance: ["a"], detourOf: "L7", ...scope });
  assert.equal(nowhere.ok, false, "a detour for a lane that does not exist is a letter with nowhere to go");

  const detour = await h.call(sup, "supervisor", "open_lane", { title: "Money type", outcome: "money is not a float", acceptance: ["a"], detourOf: "l1", ...scope });
  assert.equal(detour.ok, true, detour.text);
  const lane = h.ledger().lanes.L2!;
  assert.equal(lane.detourOf, "L1");
  assert.match(h.agents.get(lane.lead!)!.prompt!, /clears the way for L1/, "the detour's Lead is told to do that and no more");

  assert.equal((await h.call(sup, "supervisor", "close_lane", { lane: "L2", reason: "done" })).ok, true);
  await h.idle(waiting.lead!);
  assert.match(h.agents.get(waiting.lead!)!.sent.join("\n"), /CLEARED L2[\s\S]*ask if your work needs it there/, "the lane that waited cannot see the other one, so it has to be told");
  h.runtime.dispose();
});

test("a lane closed while its Lead is still writing keeps the working copy until that turn ends", async () => {
  const h = harness("outbox-closerace.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Cut short", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  const lane = h.ledger().lanes.L1!;
  writeFileSync(join(lane.worktree!, "half-written.txt"), "not committed yet\n");

  const closed = await h.call(sup, "supervisor", "close_lane", { lane: "L1", reason: "the outcome was wrong" });
  assert.equal(closed.ok, true, closed.text);
  assert.equal(existsSync(join(lane.worktree!, "half-written.txt")), true, "the Lead is mid-turn, and removing its copy --force would take what it has not committed");
  assert.ok(h.ledger().slots[lane.slot!], "and the copy still belongs to the lane, so nothing else is sent into it");
  assert.match(closed.text, new RegExp(`put away once ${lane.lead}`), "the Supervisor is told what it is waiting on, not that the copy is free");

  h.agents.get(lane.lead!)!.status = "idle";
  await h.endTurn(lane.lead!, "stopping");
  assert.equal(existsSync(lane.worktree!), false, "once the Lead stops, the copy is put away");
  assert.equal(existsSync(dirname(lane.worktree!)), false, "and the folder the desk made for this project's copies goes with the last of them");
  assert.deepEqual(Object.keys(h.ledger().slots), []);
  assert.equal(h.git(h.root, "branch", "--list", lane.branch).trim().length > 0, true, "the lane branch is kept for the Human either way");
  h.runtime.dispose();
});

test("a lane closed in the project's own copy does not switch the branch out from under the next lane", async () => {
  const h = harness("outbox-stalerestore.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["anything else in the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "First", outcome: "x", acceptance: ["a"], ...scope });
  const first = h.ledger().lanes.L1!;
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), first.branch);

  // Closed while its Lead is mid-turn, so putting the branch back waits for that Lead.
  const closed = await h.call(sup, "supervisor", "close_lane", { lane: "L1", reason: "wrong outcome" });
  assert.equal(closed.ok, true, closed.text);
  assert.deepEqual(h.ledger().lanes.L1!.restoring!.writers, [first.lead!], "and the wait is on the record, not in memory");

  // The next lane takes the project's copy, because nothing is open in it any more.
  const next = await h.call(sup, "supervisor", "open_lane", { title: "Second", outcome: "y", acceptance: ["a"], ...scope });
  assert.equal(next.ok, true, next.text);
  const second = h.ledger().lanes.L2!;
  assert.equal(second.slot, undefined, "in the project's own copy");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), second.branch);

  // Now the first Lead stops. Its restore is for a branch the copy has left, so it must not fire.
  h.agents.get(first.lead!)!.status = "idle";
  await h.endTurn(first.lead!, "stopping");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), second.branch, "a live lane's checkout is not somebody else's to move");
  h.commit(h.root, "a.txt", "L2 work\n");
  assert.equal(h.git(h.root, "log", "-1", "--format=%s", second.branch).trim(), "edit a.txt", "so L2's commits land on L2's branch, not on main");

  // And a Lead that never comes back at all: the round finishes what its turn was holding up.
  assert.equal((await h.call(sup, "supervisor", "close_lane", { lane: "L2", reason: "done" })).ok, true);
  h.agents.get(second.lead!)!.archivedAt = new Date().toISOString();
  await h.tick(Date.now());
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main", "the owner's own repository is not left on a dead lane's branch");
  h.runtime.dispose();
});

test("a copy waiting on a seat that never ends its turn is put away in the round, not left for good", async () => {
  const h = harness("outbox-reap.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Abandoned", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  const lane = h.ledger().lanes.L1!;
  await h.call(sup, "supervisor", "close_lane", { lane: "L1", reason: "the outcome was wrong" });
  assert.equal(existsSync(lane.worktree!), true, "the Lead is mid-turn, so the copy waits for it");
  assert.deepEqual(h.ledger().slots[lane.slot!]!.releasing!.writers, [lane.lead!], "and what it is waiting on is on the record, not only in memory");

  // The turn never ends: the owner archived the seat, it crashed, or a restart took the desk's own
  // memory of this with it. Either way nothing is writing there any more.
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  await h.tick(Date.now());

  assert.equal(existsSync(lane.worktree!), false, "the round puts it away rather than leaving a copy and a workspace for good");
  assert.deepEqual(Object.keys(h.ledger().slots), []);
  h.runtime.dispose();
});

test("a copy two seats are writing in is put away by the last of them to stop, not the first", async () => {
  const h = harness("outbox-lastout.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Both in here", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "In the lane's copy", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const task = h.ledger().tasks["L1-T1"]!;
  assert.equal(h.agents.get(task.peer!)!.cwd, lane.worktree, "a lane-mode Peer writes in the lane's own copy, beside its Lead");
  writeFileSync(join(lane.worktree!, "half-written.txt"), "the Peer is mid-sentence\n");

  const closed = await h.call(sup, "supervisor", "close_lane", { lane: "L1", reason: "the outcome was wrong" });
  assert.equal(closed.ok, true, closed.text);
  assert.match(closed.text, new RegExp(`${lane.lead} and ${task.peer}`), "both are named, because both are still writing there");

  h.agents.get(task.peer!)!.status = "idle";
  await h.endTurn(task.peer!, "stopping");
  assert.equal(existsSync(join(lane.worktree!, "half-written.txt")), true, "the Peer stopped, and the Lead is still in there");
  assert.ok(h.ledger().slots[lane.slot!], "so the copy is still the lane's");

  h.agents.get(lane.lead!)!.status = "idle";
  await h.endTurn(lane.lead!, "stopping too");
  assert.equal(existsSync(lane.worktree!), false, "the last one out puts it away");
  assert.deepEqual(Object.keys(h.ledger().slots), []);
  h.runtime.dispose();
});

test("with gateOn task, the gate really runs on a lane-mode task and the Lead is told the result, not a description", async () => {
  const h = harness("outbox-taskgate.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "test ! -f BROKEN", gateOn: "task" });
  const scope = { outOfScope: ["the rest of the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;

  await h.call(lane.lead!, "lead", "start_task", { title: "Add four", goal: "g", acceptance: ["a"], owned: ["a.txt"], ...scope });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.commit(lane.worktree!, "a.txt", "one\ntwo\nthree\nfour\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "four" });
  h.agents.get(peer)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);

  // The task is on the default, non-parallel path — the one where the task gate used to be skipped in silence.
  await h.idle(lane.lead!);
  const letter = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(letter, /MERGED L1-T1/);
  assert.match(letter, /Gate: test ! -f BROKEN passed in/, "the Lead has to be told what the gate did, not what it would do later");
  assert.doesNotMatch(letter, /Gate: runs on the whole lane/, "gateOn task means the lane note is a lie for this task");
});

test("a red task gate reaches the Lead with the hand-back, and landing it anyway is the Lead's call", async () => {
  const h = harness("outbox-gateundo.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "echo red; exit 1", gateOn: "task" });
  await h.call(sup, "supervisor", "open_lane", { title: "Bee", outcome: "b.txt changes", acceptance: ["b"], outOfScope: ["anything else in the repository"], writeSet: ["b.txt"] });
  const lane = h.ledger().lanes.L1!;
  const started = await h.call(lane.lead!, "lead", "start_task", { title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], outOfScope: ["the rest of the repository"], parallel: true });
  assert.equal(started.ok, true, started.text);
  const task = h.ledger().tasks["L1-T1"]!;
  h.commit(task.worktree!, "b.txt", "B\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "b" });

  // LEAD.md promises the per-task verdict with the hand-back, as evidence and not a veto. The desk
  // ran it only after the Lead had accepted — too late to weigh — and on red undid the merge the Lead
  // had chosen to make, finishing the task as failed. This test asserted exactly that.
  await h.idle(lane.lead!);
  const handback = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(handback, /Gate: echo red; exit 1: the gate failed with exit 1/);
  assert.match(handback, /evidence for your decision, not a decision/);

  h.agents.get(task.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged", "accepted with the verdict in hand, it lands");
  assert.match(h.git(lane.worktree!, "log", "-1", "--format=%s"), /^Merge L1-T1/);
  h.runtime.dispose();
});

test("a commit made while the lane's copy is off its branch is not accepted as landed", async () => {
  const h = harness("outbox-detached.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Regression", outcome: "the bug goes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Find it", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const task = h.ledger().tasks["L1-T1"]!;

  // What a bisect leaves behind: a clean copy, on no branch, with the fix committed into nothing.
  h.git(lane.worktree!, "checkout", "-q", "--detach", "HEAD");
  h.commit(lane.worktree!, "a.txt", "fixed at the source\n");
  const handed = await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "found and fixed it" });
  assert.equal(handed.ok, true, "the hand-back is not refused — the Peer is told, while it can still put it right");
  assert.match(handed.text, new RegExp(`not on ${lane.branch} any more`));
  assert.match(handed.text, /git bisect reset/);

  h.agents.get(task.peer!)!.status = "idle";
  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(accepted.ok, false, "clean and detached is what the desk used to read as landed");
  assert.match(accepted.text, /nothing committed in it is on the lane branch/);
  assert.equal(h.git(lane.worktree!, "show", `${lane.branch}:a.txt`), "one\ntwo\nthree\n", "and the lane branch really does not have it");
  h.runtime.dispose();
});

test("a task cannot be told to open a skill its Peer does not have", async () => {
  const h = harness("outbox-skills.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Skilled", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  const scope = { goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] };

  // Nothing in a Lead's own context lists the Peer's skills, so a guess reached the brief verbatim
  // and told the Peer to open something that is not there.
  const guessed = await h.call(lane.lead!, "lead", "start_task", { title: "Guessed", ...scope, skills: ["tdd"] });
  assert.equal(guessed.ok, false);
  assert.match(guessed.text, /no skill called tdd/);
  assert.match(guessed.text, /They have: /, "and the refusal is where the Lead finds out what there is");

  const real = guessed.text.split("They have: ")[1]!.replace(/\.$/, "").split(", ")[0]!;
  const named = await h.call(lane.lead!, "lead", "start_task", { title: "Named", ...scope, skills: [real] });
  assert.equal(named.ok, true, named.text);
  const started = Object.values(h.ledger().tasks).find((task) => task.title === "Named")!;
  assert.match(h.agents.get(started.peer!)!.prompt!, new RegExp(`Skills to open: ${real}`));
  assert.equal(Object.values(h.ledger().tasks).some((task) => task.title === "Guessed"), false, "a refused task does not take an id either");
  h.runtime.dispose();
});

test("a hand-back the Lead has not accepted still holds the lane's copy, so nothing is sent in beside it", async () => {
  const h = harness("outbox-holds.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["the rest of the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Two in a row", outcome: "a and b change", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], ...scope });
  const first = h.ledger().tasks["L1-T1"]!;
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(first.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(first.peer!)!.status = "idle";

  // Its Peer is still seated and rework would wake it in that directory, so the copy is not free yet.
  const second = await h.call(lane.lead!, "lead", "start_task", { title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], ...scope });
  assert.equal(second.ok, false);
  assert.match(second.text, /L1-T1 has handed back and is waiting on you/);
  assert.match(second.text, /Accept or cut it first/, "and the way out is named");

  // With the second task never started, the copy is clean and the first accepts as it always did.
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  const now = await h.call(lane.lead!, "lead", "start_task", { title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], ...scope });
  assert.equal(now.ok, true, now.text);

  // And a rework that would wake a Peer into another task's writing is refused, not prescribed.
  const back = await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "commit it" });
  assert.equal(back.ok, false);
  assert.match(back.text, /is merged/, "an accepted task has nothing to rework");
  await h.call(lane.lead!, "lead", "start_task", { title: "C", goal: "g", acceptance: ["c"], owned: ["c.txt"], ...scope, parallel: true });
  const par = Object.values(h.ledger().tasks).find((task) => task.title === "C")!;
  writeFileSync(join(lane.worktree!, "b.txt"), "half\n");
  const reworkPar = await h.call(lane.lead!, "lead", "rework", { task: par.id, text: "again" });
  assert.equal(reworkPar.ok, true, "a parallel task has a copy of its own, so its rework is nobody else's business");
  h.runtime.dispose();
});

test("a task whose honest answer is that nothing needed changing can be accepted, not only cut", async () => {
  const h = harness("outbox-nochange.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Audit", outcome: "the parser is checked", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Check the parser", goal: "find out whether it drops input", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;

  // The Peer investigates, finds the code already correct, and commits nothing. That is a real outcome.
  await h.call(peer, "peer", "done", { outcome: "nothing needed changing", summary: "the parser already handles it" });
  h.agents.get(peer)!.status = "idle";
  const accepted = await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  assert.equal(accepted.ok, true, accepted.text);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged", "the Lead judges the hand-back; the desk does not decide that no diff means no work");

  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /changed no files/, "the letter says plainly that nothing moved");
});

test("a seat reaches only the tools its own role holds, whatever it asks for", async () => {
  const h = harness("outbox-reach.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Work", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Edit", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;

  // The tool exists on the desk, and this seat's role is not given it.
  const reach = await h.call(peer, "peer", "open_lane", { title: "Mine", outcome: "x", acceptance: ["y"], outOfScope: ["z"] });
  assert.equal(reach.ok, false);
  assert.match(reach.text, /Unknown tool open_lane/);
  assert.equal(Object.keys(h.ledger().lanes).length, 1, "nothing was opened");

  // And a seat cannot borrow another role's name to get at them either.
  const borrowed = await h.call(peer, "lead", "start_task", { title: "Mine", goal: "g", acceptance: ["a"], owned: ["b.txt"], outOfScope: ["z"] });
  assert.equal(borrowed.ok, false);
  assert.match(borrowed.text, /lead tools are not available to it/);
});

test("two supervising seats hold one project, and each lane's mail goes to the seat that opened it", async () => {
  const h = harness("outbox-two-sups.json");
  const architecture = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "architecture");
  const safety = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "safety");
  const scope = { outOfScope: ["anything else"] };

  await h.call(architecture, "supervisor", "open_lane", { title: "Schema", outcome: "the schema moves", acceptance: ["a"], ...scope });
  // The hole found mid-lane gets its own Lead and its own copy, rather than the first lane widening to swallow it.
  await h.call(safety, "supervisor", "open_lane", { title: "Permissions", outcome: "writes are checked", acceptance: ["a"], isolate: true, detourOf: "L1", ...scope });
  const lanes = h.ledger().lanes;
  assert.equal(lanes.L1!.opener, architecture);
  assert.equal(lanes.L2!.opener, safety);
  assert.equal(lanes.L2!.detourOf, "L1");
  assert.match(h.agents.get(lanes.L2!.lead!)!.prompt ?? "", /clears the way for L1/, "the detour's Lead is told what it is unblocking");

  await h.call(lanes.L1!.lead!, "lead", "report", { summary: "schema done" });
  await h.call(lanes.L2!.lead!, "lead", "report", { summary: "permissions done" });
  await h.idle(architecture);
  await h.idle(safety);
  assert.match(h.agents.get(architecture)!.sent.join("\n"), /schema done/);
  assert.doesNotMatch(h.agents.get(architecture)!.sent.join("\n"), /permissions done/, "one supervising seat does not read another's lane");
  assert.match(h.agents.get(safety)!.sent.join("\n"), /permissions done/);
});

test("reaching a Peer directly tells its Lead what reached it, and is refused when there is no Lead to tell", async () => {
  const h = harness("outbox-reconcile.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Pricing", outcome: "discounts round correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Round", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] });
  const task = h.ledger().tasks["L1-T1"]!;

  const reached = await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "Use banker's rounding, not half-up." });
  assert.equal(reached.ok, true, reached.text);
  await h.idle(task.peer!);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(task.peer!)!.sent.join("\n"), /banker's rounding/);

  // The Lead is not merely copied: it is given back the five things it needs to hold the room's state.
  const toLead = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(toLead, /RECONCILE L1/);
  assert.match(toLead, /banker's rounding/, "what reached the Peer");
  assert.match(toLead, /Current intent: discounts round correctly/);
  assert.match(toLead, /Ownership: L1-T1 .* is still owned by/);
  assert.match(toLead, /Topology: unchanged/);
  assert.match(toLead, /Integration and acceptance: unchanged/);

  // The same instruction again is a second instruction: keyed on its words, it was dropped as a repeat
  // for the Peer and for the Lead's reconcile both, while the Supervisor was told it went.
  await h.idle(task.peer!);
  await h.idle(lane.lead!);
  assert.equal((await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "Use banker's rounding, not half-up." })).ok, true);
  await h.idle(task.peer!);
  await h.idle(lane.lead!);
  assert.equal(h.agents.get(task.peer!)!.sent.join("\n").split("banker's rounding").length - 1, 2, "both reached the Peer");
  assert.equal(h.agents.get(lane.lead!)!.sent.join("\n").split("RECONCILE L1").length - 1, 2, "and the Lead was told both times");

  // With no Lead to reconcile to, the intervention is refused rather than run behind its back.
  Object.assign(h.agents.get(lane.lead!)!, { archivedAt: new Date().toISOString(), status: "closed" });
  const orphaned = await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "One more thing." });
  assert.equal(orphaned.ok, false);
  assert.match(orphaned.text, /no running Lead/);

  // And a task already cut has no Peer left to steer: the Lead was being told it "is still owned by"
  // a Peer that had been put away, and still its to judge.
  await h.call(sup, "supervisor", "close_lane", { lane: "L1" });
  const cut = await h.call(sup, "supervisor", "message", { to: "L1-T1", text: "One more thing." });
  assert.equal(cut.ok, false);
  assert.match(cut.text, /L1-T1 is cut/);
});

test("an ask answered by the owner over a Lead's head is told to that Lead, not run behind its back", async () => {
  const h = harness("outbox-answeredfor.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Columns", outcome: "the column goes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Drop it", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const task = h.ledger().tasks["L1-T1"]!;

  // The Peer puts the question to its Lead. The round escalates unanswered asks to the owner, so the
  // owner answering one is the design — being the only one who knows the answer is not.
  const asked = await h.call(task.peer!, "peer", "ask", { question: "Drop the column or keep it nullable?", tried: "read the migration" });
  assert.equal(asked.ok, true, asked.text);
  const ask = Object.values(h.ledger().asks)[0]!;
  assert.equal(ask.to, lane.lead, "an ask goes upward, to the Lead");

  const answered = await h.call(sup, "supervisor", "answer", { ask: ask.id, text: "Drop it and migrate." });
  assert.equal(answered.ok, true, answered.text);
  await h.idle(task.peer!);
  assert.match(h.agents.get(task.peer!)!.sent.join("\n"), /Drop it and migrate/, "the Peer gets its answer");

  await h.idle(lane.lead!);
  const toLead = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(toLead, new RegExp(`ANSWERED FOR YOU: ${ask.id}`), "the Lead cannot hold the room's state on an answer it never saw");
  assert.match(toLead, /Drop it and migrate/);
  assert.match(toLead, /accepting it is still yours to judge/);
  h.runtime.dispose();
});

test("a project keeps the documents its owner asked for, and every seat that must know is told", async () => {
  const h = harness("outbox-docs.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const docsIn = join(h.project.state, "docs");

  // Nothing is kept until somebody says so, and a project that keeps none is a project that works.
  assert.equal(existsSync(docsIn), false);
  const none = await h.call(sup, "supervisor", "set_project", {});
  assert.match(none.text, /Documents kept: none/);
  assert.match(none.text, /- decision: /, "the shelf offers each one's moment, which is the only basis for taking it");

  const unknown = await h.call(sup, "supervisor", "set_project", { docs: ["retrospective-log"] });
  assert.equal(unknown.ok, false);
  assert.match(unknown.text, /no document called retrospective-log/);

  const kept = await h.call(sup, "supervisor", "set_project", { docs: ["decision", "detour"] });
  assert.equal(kept.ok, true, kept.text);
  assert.ok(existsSync(join(docsIn, "decision.md")));
  assert.ok(existsSync(join(docsIn, "detour.md")));
  assert.equal(existsSync(join(docsIn, "postmortem.md")), false, "a document nobody asked for is never written");

  // What the owner has written is never written over.
  writeFileSync(join(docsIn, "decision.md"), "# D1: ours\n");
  await h.call(sup, "supervisor", "set_project", { docs: ["decision", "detour"] });
  assert.equal(readFileSync(join(docsIn, "decision.md"), "utf-8"), "# D1: ours\n");

  // And a Lead is told which documents exist, since one nobody updates is worse than none.
  await h.call(sup, "supervisor", "open_lane", { title: "Work", outcome: "x", acceptance: ["y"], outOfScope: ["z"] });
  const lane = h.ledger().lanes.L1!;
  assert.match(h.agents.get(lane.lead!)!.prompt ?? "", /keeps these documents .*decision, detour/);

  // A directive is read once, when the Lead is seated. A lane already open hears the change by mail
  // or never hears it at all.
  const added = await h.call(sup, "supervisor", "set_project", { docs: ["decision", "detour", "handoff"] });
  assert.equal(added.ok, true, added.text);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /DOCUMENTS: this project now keeps these under .*decision, detour, handoff/);

  // Dropping one stops it being carried; what was written stays where it is.
  const dropped = await h.call(sup, "supervisor", "set_project", { docs: [] });
  assert.match(dropped.text, /Documents kept: none/);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /DOCUMENTS: this project no longer keeps any/, "and told when the last one goes");
  assert.ok(existsSync(join(docsIn, "decision.md")), "dropping one does not throw away what was written in it");
});

test("a review hands back a verdict and its findings, and the Lead is told both", async () => {
  const h = harness("outbox-review.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Rounding", outcome: "money rounds correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Round", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] });
  h.commit(lane.worktree!, "a.txt", "rounded\n");
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "rounded" });
  h.agents.get(peer)!.status = "idle";

  const opened = await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is half-up right for money here?" });
  assert.equal(opened.ok, true, opened.text);
  const review = Object.values(h.ledger().tasks).find((task) => task.kind === "review")!;
  const reviewer = review.peer!;

  // A reviewer hands back a judgement, not work. The words it is given to do that with are its own
  // tool set's, and they have to survive all the way to the Lead.
  const handed = await h.call(reviewer, "reviewer", "done", {
    verdict: "accept",
    findings: "P3 a.txt:1 — banker's rounding would be safer at the boundary, but half-up matches the spec.",
    checks: "Read the diff and ran the rounding cases.",
  });
  assert.equal(handed.ok, true, handed.text);
  assert.equal(h.ledger().tasks[review.id]!.handback?.outcome, "accept", "an accepted review is recorded as accepted, not as changes");

  await h.idle(lane.lead!);
  const toLead = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(toLead, /Verdict: accept/);
  assert.match(toLead, /banker's rounding would be safer/, "the review itself reaches the Lead rather than being dropped");
});

test("a copy a reviewer is reading is not taken away when the task it reviews is accepted", async () => {
  const h = harness("outbox-reviewshare.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["the rest of the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Reviewed", outcome: "a changes", acceptance: ["a"], outOfScope: ["anything else in the repository"], writeSet: ["a.txt"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], ...scope, parallel: true });
  const task = h.ledger().tasks["L1-T1"]!;
  h.commit(task.worktree!, "a.txt", "A\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(task.peer!)!.status = "idle";

  // The documented way to review a task's commits: it reads them in that task's own working copy.
  assert.equal((await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Is this right at the boundary?" })).ok, true);
  const review = Object.values(h.ledger().tasks).find((entry) => entry.kind === "review")!;
  assert.equal(review.slot, task.slot, "the ledger says which copy the reviewer is living in");

  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.equal(existsSync(review.worktree!), true, "the reviewer is mid-turn, and its verdict is what the Lead was told to wait for");

  h.agents.get(review.peer!)!.status = "idle";
  await h.endTurn(review.peer!, "verdict sent");
  assert.equal(existsSync(review.worktree!), false, "once it stops, the copy goes as it always did");

  // And a review started *after* the copy is already marked for teardown is not seated in it: that
  // copy goes the moment the task's own Peer ends its turn, whatever the reviewer was told.
  await h.call(lane.lead!, "lead", "start_task", { title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], ...scope, parallel: true });
  const second = Object.values(h.ledger().tasks).find((entry) => entry.title === "B")!;
  h.commit(second.worktree!, "b.txt", "B\n");
  await h.call(second.peer!, "peer", "done", { outcome: "complete", summary: "b" });
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: second.id })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.ok(h.ledger().slots[second.slot!]?.releasing, "its Peer is mid-turn, so the copy is waiting to be put away");

  assert.equal((await h.call(lane.lead!, "lead", "start_review", { task: second.id, focus: "and this one?" })).ok, true);
  const late = Object.values(h.ledger().tasks).find((entry) => entry.kind === "review" && entry.of === second.id)!;
  assert.notEqual(late.worktree, second.worktree, "it reads the merge from the lane's copy instead");
  assert.match(h.agents.get(late.peer!)!.prompt!, /as the merge/);
  h.runtime.dispose();
});

test("a review of a parallel task whose copy went back is pointed at the merge that holds the change", async () => {
  const h = harness("outbox-reviewgone.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const scope = { outOfScope: ["the rest of the repository"] };
  await h.call(sup, "supervisor", "open_lane", { title: "Two files", outcome: "both change", acceptance: ["a"], outOfScope: ["anything else in the repository"], writeSet: ["a.txt", "b.txt"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], ...scope, parallel: true });
  const task = h.ledger().tasks["L1-T1"]!;
  h.commit(task.worktree!, "a.txt", "A\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(task.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.equal(Object.keys(h.ledger().slots).length, 0, "the copy the task worked in has gone back");

  const opened = await h.call(lane.lead!, "lead", "start_review", { task: "L1-T1", focus: "Does this hold at the boundary?" });
  assert.equal(opened.ok, true, opened.text);
  const review = Object.values(h.ledger().tasks).find((entry) => entry.kind === "review")!;
  const merge = h.ledger().tasks["L1-T1"]!.mergeSha!;
  const brief = h.agents.get(review.peer!)!.prompt!;
  assert.match(brief, new RegExp(`The change is in ${lane.branch}, as the merge ${merge.slice(0, 7)}`), "its own copy and branch are both gone once the work lands");
  assert.match(brief, new RegExp(`git diff ${merge}\\^1\\.\\.${merge}`), "a range that shows nothing is a review of nothing");
  assert.equal(h.git(lane.worktree!, "diff", "--name-only", `${merge}^1..${merge}`).trim(), "a.txt", "and the range really shows the task's work");

  // A task cut before it committed leaves neither a copy nor a branch, and there is nothing to read.
  await h.call(lane.lead!, "lead", "start_task", { title: "B", goal: "g", acceptance: ["b"], owned: ["b.txt"], ...scope, parallel: true });
  const empty = Object.values(h.ledger().tasks).find((entry) => entry.title === "B")!;
  const cutReply = await h.call(lane.lead!, "lead", "cut", { task: empty.id, reason: "wrong shape" });
  assert.equal(cutReply.ok, true, cutReply.text);
  assert.equal(h.git(h.root, "branch", "--list", empty.branch!).trim(), "", "a cut task with no commits of its own leaves no branch behind");
  const nothing = await h.call(lane.lead!, "lead", "start_review", { task: empty.id, focus: "anything?" });
  assert.equal(nothing.ok, false);
  assert.match(nothing.text, /neither a merge nor a branch is left to read it from/);
  h.runtime.dispose();
});

test("a task branch is dropped once its work is in the lane's, whichever branch the project's own copy is on", async () => {
  const h = harness("outbox-branchdrop.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  // The lane takes a copy of its own, so the project's copy stays on main — and main is what
  // `git branch -d` would read there, though the task's work lands in the lane's branch.
  await h.call(sup, "supervisor", "open_lane", { title: "Apart", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"], isolate: true });
  const lane = h.ledger().lanes.L1!;
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main");
  await h.call(lane.lead!, "lead", "start_task", { title: "A", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"], parallel: true });
  const task = h.ledger().tasks["L1-T1"]!;
  h.commit(task.worktree!, "a.txt", "A\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(task.peer!)!.status = "idle";
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).ok, true);
  await h.runtime.desk.settled(h.project);

  assert.equal(h.ledger().tasks["L1-T1"]!.status, "merged");
  assert.equal(h.git(lane.worktree!, "show", `${lane.branch}:a.txt`), "A\n", "the work is in the lane's branch");
  assert.equal(h.git(h.root, "branch", "--list", task.branch!).trim(), "", "and its own branch has nothing the lane does not, so it goes");
  h.runtime.dispose();
});

test("a task goes to a role that writes, and a review to one that reads, and neither stands in for the other", async () => {
  const h = harness("outbox-lenses.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;

  // The preset's Reviewer holds `work` — that is how its ask and its turn-end are routed like any
  // other seat on a task — and it is denied edit, write and every git write by its own settings. So it
  // is not a second kind of Peer, and offering it as one started a seat that could not do the job.
  const readOnly = await h.call(lane.lead!, "lead", "start_task", { title: "Add four", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"], role: "reviewer" });
  assert.equal(readOnly.ok, false, "a role that only reads cannot be given a task to write");
  assert.match(readOnly.text, /no reviewer that can take a task/i);
  assert.match(readOnly.text, /peer/, "and the refusal names who can, rather than recommending the one that cannot");
  assert.deepEqual(Object.keys(h.ledger().tasks), [], "and nothing was started or recorded");

  // The other direction, and the default.
  const wrongLens = await h.call(lane.lead!, "lead", "start_review", { focus: "Is the rounding right?", role: "peer" });
  assert.equal(wrongLens.ok, false);
  assert.match(wrongLens.text, /no peer that can review/i);
  assert.match(wrongLens.text, /reviewer/, "the refusal names what there is to choose from");

  const byDefault = await h.call(lane.lead!, "lead", "start_task", { title: "Add five", goal: "g", acceptance: ["a"], owned: ["b.txt"], outOfScope: ["the rest"] });
  assert.equal(byDefault.ok, true, byDefault.text);
  const seated = Object.values(h.ledger().tasks).find((task) => task.title === "Add five")!;
  assert.match(h.agents.get(seated.peer!)!.provider, /peer/, "left out, it is the preset's own default");
  h.runtime.dispose();
});

test("two projects on one daemon both name their first task L1-T1, and both Leads are told when their Peer is gone", async () => {
  const h = harness("outbox-twoprojects.json");
  const second = repo();
  const other = projectOf(second.root);

  const open = async (where: string, name: string) => {
    const sup = h.add("sw2-supervisor-claude/claude-opus-5", where, name);
    await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["the rest"] }, where);
    const lane = h.ledger(where === h.root ? undefined : other).lanes.L1!;
    await h.call(lane.lead!, "lead", "start_task", { title: "Add four", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] }, where);
    return lane;
  };
  const here = await open(h.root, "sup-a");
  const there = await open(second.root, "sup-b");

  const mine = h.ledger().tasks.L1_T1 ?? h.ledger().tasks["L1-T1"]!;
  const theirs = h.ledger(other).tasks["L1-T1"]!;
  assert.equal(mine.id, theirs.id, "the two ledgers really do use the same task id");

  // Both Peers are closed. Each Lead is owed a letter about its own project's task.
  for (const task of [mine, theirs]) h.agents.get(task.peer!)!.archivedAt = new Date().toISOString();
  await h.tick(Date.now());
  await h.idle(here.lead!);
  await h.idle(there.lead!);

  assert.match(h.agents.get(here.lead!)!.sent.join("\n"), /the Peer on L1-T1/, "the first project's Lead is told");
  assert.match(h.agents.get(there.lead!)!.sent.join("\n"), /the Peer on L1-T1/, "and so is the second's — the letter key and the seen-it flag are per project");
  assert.equal(h.ledger(other).tasks["L1-T1"]!.status, "stalled", "and the second project's task is recorded stalled, not skipped");
  h.runtime.dispose();
});

test("a Peer stopped on a question is answered by its Lead's message, and one stopped on anything else waits for the Human", async () => {
  const h = harness("outbox-question.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Colours", outcome: "the button is coloured", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Colour", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  const question: Pending = {
    id: "permission-1",
    kind: "question",
    name: "AskUserQuestion",
    title: "Which colour should the button be?",
    input: { questions: [{ question: "Which colour should the button be?", header: "Colour", options: [{ label: "Blue" }, { label: "Green" }] }] },
  };
  h.agents.get(peer)!.pending.push(question);
  await h.permission(peer, question);
  await h.idle(lane.lead!);
  const letter = h.agents.get(lane.lead!)!.sent.join("\n");
  assert.match(letter, /WAITING FOR PERMISSION/);
  assert.match(letter, /1\. Which colour should the button be\?\n {3}Options: Blue \/ Green/, "the question itself, not only that there is one");
  assert.match(letter, /`message` to L1-T1/);

  // The Peer reads nothing until the question is answered, so a message held for it would never land.
  const answered = await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: "Blue, to match the header." });
  assert.equal(answered.ok, true, answered.text);
  assert.match(answered.text, /as the answer/);
  const words = "From your lead: Blue, to match the header.";
  assert.deepEqual(h.agents.get(peer)!.answered, [
    { requestId: "permission-1", response: { behavior: "allow", updatedInput: { answers: { "Which colour should the button be?": words, Colour: words } } } },
  ]);
  await h.idle(peer);
  assert.doesNotMatch(h.agents.get(peer)!.sent.join("\n"), /Blue, to match/, "answered once, not also mailed");

  // Leave to run something is the Human's to give; the desk answers nothing on anyone's behalf.
  const command: Pending = { id: "permission-2", kind: "tool", name: "Bash", title: "rm -rf build" };
  h.agents.get(peer)!.pending.push(command);
  await h.permission(peer, command);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /Bash: rm -rf build\n\nOnly the Human can answer this/);
  const held = await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: "Go ahead." });
  assert.equal(held.ok, true, held.text);
  assert.match(held.text, /stopped on a permission only the Human can give/);
  assert.equal(h.agents.get(peer)!.answered.length, 1);
  assert.equal(h.runtime.outbox.pending(peer).length, 1, "and the message waits for it");
});

test("mail reaches a running seat inside its turn where its harness can take it there, and waits where it cannot", async () => {
  const h = harness("outbox-steer.json");
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Pricing", outcome: "discounts round correctly", acceptance: ["a"], outOfScope: ["anything else"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Round", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  assert.equal(h.agents.get(lane.lead!)!.status, "running");
  assert.equal(h.agents.get(peer)!.status, "running");

  // Paseo turns a steer the provider cannot take yet into replacing the turn, so a turn in its first
  // minute is left alone.
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    h.beginTurn(lane.lead!);
    h.beginTurn(peer);
    const early = await h.call(sup, "supervisor", "message", { to: "L1", text: "Is the premise right?" });
    assert.match(early.text, /Queued for the Lead of L1/);
    mock.timers.tick(2 * 60_000);
    await h.tick();
    assert.match(h.agents.get(lane.lead!)!.steered.join("\n"), /Is the premise right\?/, "the round delivers it once the turn has settled");

    const toLead = await h.call(sup, "supervisor", "message", { to: "L1", text: "Stop: the premise is wrong." });
    assert.match(toLead.text, /Delivered to the Lead of L1/);
    assert.match(h.agents.get(lane.lead!)!.steered.join("\n"), /the premise is wrong/, "the Lead's harness takes it mid-turn");

    const toPeer = await h.call(lane.lead!, "lead", "message", { to: "L1-T1", text: "Stop: the premise is wrong." });
    assert.match(toPeer.text, /Queued for the Peer on L1-T1/);
    assert.deepEqual(h.agents.get(peer)!.sent, [], "the Peer's harness cannot, and sending would replace its turn");
  } finally {
    mock.timers.reset();
  }
});

async function laneWithPeer(outbox: string, settings?: Record<string, unknown>) {
  const h = harness(outbox);
  if (settings) {
    mkdirSync(h.project.state, { recursive: true });
    writeFileSync(join(h.project.state, "settings.json"), JSON.stringify(settings));
  }
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Build", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "start_task", { title: "Clean build", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  await h.tick();
  return { h, sup, lane, peer, timeline: h.timelineOf(peer) };
}

const incidentsOf = (state: string) => JSON.parse(readFileSync(join(state, "incidents.json"), "utf-8")).items as Record<string, { kind: string; held?: string; told?: number; level: string }>;

test("an irreversible command a Peer starts reaches the Supervisor before the call finishes, and nothing of it reaches the Peer", async () => {
  const { h, sup, peer, timeline } = await laneWithPeer("outbox-incident.json", { attention: { watch: true } });
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "running", detail: { type: "unknown", input: {}, output: null } }, "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "running", detail: { type: "shell", command: "rm -rf build" } }, "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.idle(sup);
  const told = h.agents.get(sup)!.sent.join("\n");
  assert.match(told, /INCIDENT I1 \(destructive, page\) on the Peer on L1-T1 \(Clean build\)/);
  assert.match(told, /What was seen: rm -rf build/);
  assert.match(told, /not a verdict/);
  assert.ok(!timeline.rows.some((row) => row.item.status === "completed"), "the call it warns about is still running");
  assert.deepEqual(h.runtime.outbox.letters().filter((letter) => letter.to === peer), [], "nothing the watch concluded is even queued for the seat it watches");
  await h.idle(peer);
  const watched = h.agents.get(peer)!;
  assert.deepEqual([...watched.sent, ...watched.steered].filter((text) => /INCIDENT|destructive|rm -rf|incident/i.test(text)), [], "nor reaches it when its turn ends");
  h.runtime.dispose();
});

test("with the watch on but not telling, the desk records what it sees and sends nothing until the owner turns it on", async () => {
  const { h, sup, timeline } = await laneWithPeer("outbox-shadow.json");
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "running", detail: { type: "shell", command: "git push --force origin main" } }, "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.idle(sup);
  assert.deepEqual(Object.values(incidentsOf(h.project.state)).map((item) => [item.kind, item.held]), [["destructive", "shadow"]]);
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /INCIDENT/);
  h.runtime.dispose();
});

test("left as the kit ships it there is no key, so nothing is watched and nothing is recorded", async () => {
  const { h, sup, timeline } = await laneWithPeer("outbox-off.json");
  writeFileSync(join(HOME, ".local", "share", "seatworks-v2", "settings.json"), JSON.stringify({}));
  await h.tick();
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "running", detail: { type: "shell", command: "git push --force origin main" } }, "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.idle(sup);
  // Off is off. The irreversible command is the loudest thing the watch reads in code, and with no
  // key it is not read: the seat is not followed, so there is no book to record it in.
  assert.equal(existsSync(join(h.project.state, "incidents.json")), false);
  h.runtime.dispose();
});

test("each assessment is kept with the state, questions, facts and answers it was made on, and is decided on the facts that were sent", async (t) => {
  const { h, peer, timeline } = await laneWithPeer("outbox-kept.json");
  writeFileSync(join(HOME, ".local", "share", "seatworks-v2", "settings.json"), JSON.stringify({ sensor: { key: "sk-or-kept-test" } }));
  const bodies: { questions: Record<string, unknown> }[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  t.mock.method(globalThis, "fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { questions: Record<string, unknown> };
    bodies.push(body);
    await held;
    const answers = Object.fromEntries(Object.keys(body.questions).map((name) => [name, { type: "noul", noul: name === "goal_drift" ? 0.9 : 0.1 }]));
    return new Response(JSON.stringify({ answers, model: "typesafe/jev-1.13-20260917", id: "gen-kept", usage: { cost: 0.00002 } }), { status: 200 });
  });
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  timeline.add({ type: "tool_call", callId: "c0", name: "Edit", status: "completed", detail: { type: "edit", filePath: "b.txt", oldString: "x", newString: "y" } }, "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "completed", detail: { type: "shell", command: "rm -rf build", output: "" } }, "t1");
  timeline.beat("turn_completed", "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  timeline.beat("turn_started", "t2");
  timeline.add({ type: "user_message", text: "Now the docs" }, "t2");
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const kept = readAssessments(h.project.state).kept;
  const first = kept.find((record) => (record.state as { prompt: string }).prompt === "Clean the build");
  assert.ok(first, "the assessment is kept");
  assert.equal(first.seat, peer);
  assert.equal(first.model, "typesafe/jev-1.13-20260917");
  assert.equal(first.turnId, "t1", "filed under the turn it was asked about, though the next had begun when the answer came");
  assert.deepEqual(first.facts.map((fact) => fact.kind), ["outside-scope", "destructive"], "the facts noted when the state was taken");
  assert.deepEqual(first.found, ["goal_drift"], "decided on those facts, though the seat was told something new while the answer was on its way");
  assert.equal((first.state as { turn: string }).turn, "running");
  assert.ok((first.state as { gate?: string }).gate, "the gate the project checks with, or that it has none");
  assert.deepEqual(Object.keys(first.questions), Object.keys(bodies[0]!.questions));
  assert.ok(!("unverified_success" in first.questions), "a turn that ends without a word claims nothing, so nothing is asked about a claim");
  assert.doesNotMatch(JSON.stringify(kept), /sk-or-kept-test/);
  h.runtime.dispose();
});

test("the flow screen can say what the watch is doing: which seats, how many readings, what they cost", async (t) => {
  const { h, peer, timeline } = await laneWithPeer("outbox-watchview.json");
  t.mock.method(globalThis, "fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { questions: Record<string, unknown> };
    const answers = Object.fromEntries(Object.keys(body.questions).map((name) => [name, { type: "noul", noul: name === "goal_drift" ? 0.81 : 0.1 }]));
    return new Response(JSON.stringify({ answers, model: "typesafe/jev-1.13-20260917", id: "gen-view", usage: { cost: 0.00013 } }), { status: 200 });
  });
  const off = (await h.runtime.control.flow(h.project.slug)) as { watch: WatchView };
  assert.equal(off.watch.on, true, "a key is set in this harness, so the watch is on");
  assert.deepEqual(off.watch.seats.map((seat: WatchSeat) => seat.role).sort(), ["lead", "peer"], "the two roles that carry `watched`, and no Supervisor");
  assert.deepEqual(off.watch.seats.map((seat: WatchSeat) => seat.readings), [0, 0], "nothing read yet");

  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Edit", status: "completed", detail: { type: "edit", filePath: "b.txt", oldString: "x", newString: "y" } }, "t1");
  timeline.beat("turn_completed", "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 60));

  const view = (await h.runtime.control.flow(h.project.slug)) as { watch: WatchView };
  const read = view.watch.seats.find((seat: WatchSeat) => seat.id === peer)!;
  assert.equal(read.readings, 1);
  assert.equal(read.cost, 0.00013, "what the watch has spent on this seat, which is the number the owner is paying");
  // The highest any question reached, not the last one: a screen showing only the last reading says
  // nothing about the turn where something came within a hundredth of opening an incident.
  assert.deepEqual(read.highest, { question: "goal_drift", p: 0.81 });
  h.runtime.dispose();
});

test("a stuck seat the sensor does not think stuck is held back from the Supervisor, and the sensor's word is kept on the incident", async (t) => {
  const { h, sup, timeline } = await laneWithPeer("outbox-vetoed.json", { attention: { watch: true } });
  t.mock.method(globalThis, "fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { questions: Record<string, unknown> };
    const answers = Object.fromEntries(Object.keys(body.questions).map((name) => [name, { type: "noul", noul: 0.1 }]));
    return new Response(JSON.stringify({ answers, model: "typesafe/jev-1.13-20260917" }), { status: 200 });
  });
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Make the build pass" }, "t1");
  for (let index = 0; index < 3; index++) timeline.add({ type: "tool_call", callId: `c${index}`, name: "Bash", status: "failed", detail: { type: "shell", command: "npm run build", output: "error TS2345", exitCode: 2 } }, "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 60));
  await h.idle(sup);
  const stuck = Object.values(JSON.parse(readFileSync(join(h.project.state, "incidents.json"), "utf-8")).items as Record<string, { kind: string; held?: string; told?: number; sensor?: { question: string; says: string } }>).find((item) => item.kind === "stuck");
  assert.ok(stuck, "the code still opens the incident");
  assert.equal(stuck.held, "vetoed");
  assert.deepEqual([stuck.sensor?.question, stuck.sensor?.says], ["worker_stuck", "vetoes"]);
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /INCIDENT/);
  assert.ok(readAssessments(h.project.state).kept.some((record) => record.verdicts.some((verdict) => verdict.kind === "stuck" && verdict.says === "vetoes")), "the judgement is kept with the assessment it came from");
  h.runtime.dispose();
});

test("a turn that runs long is told without waiting on the sensor, which cannot see time", async () => {
  const { h, sup, timeline } = await laneWithPeer("outbox-long-turn.json", { attention: { watch: true } });
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Make the build pass" }, "t1");
  await settle();
  await h.tick(Date.now() + 31 * 60_000);
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I1 \(long-turn, attend\)/);
  h.runtime.dispose();
});

test("a turn that ends asking for a decision is raised on that one reading, while one still running needs a second reading in the same turn", async (t) => {
  const { h, sup, timeline } = await laneWithPeer("outbox-needs-human.json", { attention: { watch: true } });
  t.mock.method(globalThis, "fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { questions: Record<string, unknown>; state: { turn: string; final_message: string } };
    const asks = body.state.turn === "running" || body.state.final_message.startsWith("Should I");
    const answers = Object.fromEntries(Object.keys(body.questions).map((name) => [name, { type: "noul", noul: name === "needs_human" && asks ? 0.95 : 0.1 }]));
    return new Response(JSON.stringify({ answers, model: "typesafe/jev-1.13-20260917" }), { status: 200 });
  });
  const kinds = () => Object.values(incidentsOf(h.project.state)).map((item) => item.kind);
  const failing = (id: string, command: string) => ({ type: "tool_call", callId: id, name: "Bash", status: "failed", detail: { type: "shell", command, output: "no", exitCode: 1 } });
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Tidy the build" }, "t1");
  timeline.add(failing("a1", "make one"), "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 30));
  timeline.beat("turn_started", "t2");
  timeline.add(failing("b1", "make two"), "t2");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(kinds(), [], "a reading in the turn before does not count as the second");
  timeline.beat("turn_completed", "t2");
  timeline.beat("turn_started", "t3");
  timeline.add({ type: "user_message", text: "Go on" }, "t3");
  timeline.add({ type: "assistant_message", text: "Should I delete the legacy folder or keep it?", messageId: "m1" }, "t3");
  timeline.beat("turn_completed", "t3");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await h.idle(sup);
  assert.deepEqual(kinds(), ["needs_human"]);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I1 \(needs_human, attend\)/);
  h.runtime.dispose();
});

test("a seat whose brief cannot be read is not described to the sensor as having none", async (t) => {
  const { h, timeline } = await laneWithPeer("outbox-unbriefed.json");
  writeFileSync(join(h.project.state, "ledger.json"), "{ not json");
  const asked = t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 500 }));
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "completed", detail: { type: "shell", command: "ls", output: "a" } }, "t1");
  timeline.beat("turn_completed", "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(asked.mock.callCount(), 0);
  assert.match(readFileSync(join(h.project.state, "events.log"), "utf-8"), /"kind":"watch.unbriefed"/);
  h.runtime.dispose();
});

test("taking the key away does not release the incidents the watch was still holding", async () => {
  const { h, sup } = await laneWithPeer("outbox-retell-off.json", { attention: { watch: true } });
  // `stuck` is a kind the sensor confirms, so this is held "awaiting" its reading rather than sent.
  await h.runtime.desk.notice(h.project, { id: "p-a", provider: "sw2-peer-devin/swe-2-max", title: "p-a" }, [{ kind: "stuck", level: "attend", quote: "round and round", facts: ["stuck"] }]);
  assert.deepEqual(Object.values(incidentsOf(h.project.state)).map((item) => item.held), ["awaiting"]);

  writeFileSync(join(HOME, ".local", "share", "seatworks-v2", "settings.json"), JSON.stringify({}));
  await h.tick();
  await h.idle(sup);
  // With no key there is no watch, so there is nothing to tell later either. Worse than merely
  // carrying on: the retell reads which kinds the sensor confirms, and with the key gone that set is
  // empty, so the hold dissolves and removing the key is the very thing that sends the mail.
  assert.deepEqual(Object.values(incidentsOf(h.project.state)).map((item) => item.held), ["awaiting"], "still held, not released by the watch being switched off");
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /INCIDENT/);
  h.runtime.dispose();
});

test("a day's budget holds back what is only worth attention, however many arrive at once, and never what is irreversible", async () => {
  const { h, sup } = await laneWithPeer("outbox-budget.json", { attention: { watch: true, incidentsPerDay: 1 } });
  const seat = (id: string) => ({ id, provider: "sw2-peer-devin/swe-2-max", title: id });
  // Not `stuck`: the sensor confirms that one, so it is held awaiting a reading first and the budget
  // never gets a say. This test is about the budget, so it uses a kind nothing else holds back.
  const attend = (quote: string) => [{ kind: "test-weakened", level: "attend" as const, quote, facts: ["test-weakened"] }];
  await Promise.all([
    h.runtime.desk.notice(h.project, seat("p-a"), attend("one")),
    h.runtime.desk.notice(h.project, seat("p-b"), attend("two")),
    h.runtime.desk.notice(h.project, seat("p-c"), attend("three")),
    h.runtime.desk.notice(h.project, seat("p-d"), [{ kind: "destructive", level: "page", quote: "rm -rf /", facts: ["destructive"] }]),
  ]);
  const items = Object.values(incidentsOf(h.project.state));
  assert.equal(items.filter((item) => item.level === "attend" && item.told !== undefined).length, 1, "one attention a day, as set");
  assert.equal(items.filter((item) => item.held === "budget").length, 2);
  assert.ok(items.find((item) => item.kind === "destructive")!.told, "an irreversible act is never held for budget");
  await h.idle(sup);
  assert.equal((h.agents.get(sup)!.sent.join("\n").match(/INCIDENT/g) ?? []).length, 2);
  h.runtime.dispose();
});

test("two projects each hear about their own seats, though their incidents carry the same number", async () => {
  const { h, sup } = await laneWithPeer("outbox-two-projects.json", { attention: { watch: true } });
  const second = repo();
  const other = projectOf(second.root);
  mkdirSync(other.state, { recursive: true });
  writeFileSync(join(other.state, "settings.json"), JSON.stringify({ attention: { watch: true } }));
  const supB = h.add("sw2-supervisor-claude/claude-opus-5", second.root, "sup-b");
  const page = [{ kind: "destructive", level: "page" as const, quote: "rm -rf build", facts: ["destructive"] }];
  await h.runtime.desk.notice(h.project, { id: "p-a", provider: "sw2-peer-devin/swe-2-max" }, page);
  await h.runtime.desk.notice(other, { id: "p-b", provider: "sw2-peer-devin/swe-2-max" }, page);
  await h.idle(sup);
  await h.idle(supB);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I1 \(destructive, page\)/);
  assert.match(h.agents.get(supB)!.sent.join("\n"), /INCIDENT I1 \(destructive, page\)/, "the second project's owner is told too, not dropped as a repeat of the first");
  h.runtime.dispose();
});

test("a desk call the harness refused for bad JSON is recorded, though it never reached the desk", async () => {
  const { h, sup } = await laneWithPeer("outbox-malformed.json");
  h.beginTurn(sup);
  await h.endTurn(sup, "Opening the lane.", {
    type: "tool_call",
    callId: "c1",
    name: "mcp__team__open_lane",
    status: "failed",
    error: { content: "InputValidationError: mcp__team__open_lane was called with input that could not be parsed as JSON." },
    detail: { type: "unknown", input: { __unparsedToolInput: { raw: '{"title": "Build"' } }, output: null },
  });
  // Nothing else here has heard of this call: it never reached the desk, so there is no `tool` event
  // for it, and the Supervisor is the one role no watch follows. Its own retry was the whole record.
  const log = readFileSync(join(h.project.state, "events.log"), "utf-8");
  assert.match(log, /"kind":"call\.malformed"/);
  assert.match(log, /"tool":"mcp__team__open_lane"/);
  assert.match(log, /"role":"supervisor"/, "the Supervisor is the one role no watch follows, so this is the only way it is ever said");
  assert.equal(log.match(/"ok":false/g), null, "and no failed desk call was recorded, because the desk was never reached");

  // Paseo hands the hook the whole session, so the turn after this one carries the same failed call
  // again. It is one thing that happened once, and the log must say so once.
  await h.endTurn(sup, "Now the task.", { type: "tool_call", callId: "c2", name: "status", status: "completed", detail: {} });
  assert.equal(readFileSync(join(h.project.state, "events.log"), "utf-8").match(/"kind":"call\.malformed"/g)!.length, 1);

  // And it is trouble whatever the watch is doing: the harness refused the call, not the sensor.
  writeFileSync(join(HOME, ".local", "share", "seatworks-v2", "settings.json"), JSON.stringify({}));
  const view = (await h.runtime.control.flow(h.project.slug)) as { watch: WatchView };
  assert.equal(view.watch.on, false);
  assert.deepEqual(view.watch.trouble.map((entry) => entry.kind), ["call.malformed"], "shown with the watch off, or nobody is told after all");
  h.runtime.dispose();
});

test("with the watch off a lane's own record is not gone through either", async () => {
  const { h, sup, lane, peer } = await laneWithPeer("outbox-history-off.json");
  writeFileSync(join(HOME, ".local", "share", "seatworks-v2", "settings.json"), JSON.stringify({}));
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  await h.tick();
  await h.idle(sup);
  // The history facts are the watch reading the desk's record rather than a timeline. They are the
  // half that needs no key to compute, which is exactly why they used to keep running with the watch
  // switched off — a project with no key still filled the Supervisor's mail.
  assert.equal(existsSync(join(h.project.state, "incidents.json")), false);
  h.runtime.dispose();
});

test("a task the Lead keeps sending back is an incident about the Lead, raised once and never shown to it", async () => {
  const { h, sup, lane, peer } = await laneWithPeer("outbox-history.json", { attention: { watch: true } });
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.reworks, 3, "three sendings-back are on the record");

  await h.tick();
  await h.idle(sup);
  const told = h.agents.get(sup)!.sent.join("\n");
  assert.match(told, /INCIDENT I1 \(rework-loop, attend\) on the Lead of L1 \(Build\)/, "the seat it is about is the one that decides to send it back");
  assert.match(told, /What was seen: L1-T1 \(Clean build\) has been sent back 3 times/);

  // A window would never hold this: every rework letter is a message, which restarts it. And what a
  // window sees is an episode that ends, while three sendings-back stay three forever — so once the
  // Supervisor has marked this one, the same unchanged record must not raise it again on the next
  // round, and the round after that.
  const marked = await h.call(sup, "supervisor", "ack", { id: "I1", verdict: "noise", note: "expected: the brief changed under it" });
  assert.equal(marked.ok, true, marked.text);
  await h.tick();
  await h.tick();
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), ["I1"], "the same three sendings-back are not raised again once they have been marked");

  // A fourth is new evidence, and is raised.
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "round 4" });
  await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "still not" });
  await h.tick();
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), ["I1", "I2"], "a fourth sending-back is something new to say");

  h.runtime.dispose();
});

test("a standing condition held back while the watch is off is still there to tell when it is turned on", async () => {
  // The shipped default: everything is recorded and nothing is mailed. A timeline fact survives that
  // because the seat keeps acting and the watch sees it again; a lane's history never changes on its
  // own, so if the patrol only ever looked once, turning the watch on would tell nobody anything.
  const { h, sup, lane, peer } = await laneWithPeer("outbox-history-shadow.json");
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  await h.tick();
  await h.idle(sup);
  assert.deepEqual(Object.values(incidentsOf(h.project.state)).map((item) => [item.kind, item.held]), [["rework-loop", "shadow"]]);
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /INCIDENT/);

  writeFileSync(join(h.project.state, "settings.json"), JSON.stringify({ attention: { watch: true } }));
  await h.tick();
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /INCIDENT I1 \(rework-loop, attend\)/, "the same unchanged record is told once the owner turns it on");
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), ["I1"], "and it is the incident already on the book, not a second one");
  h.runtime.dispose();
});

test("a lane whose Lead has gone raises nothing about it, since nothing would ever close it", async () => {
  const { h, lane, peer } = await laneWithPeer("outbox-history-gone.json", { attention: { watch: true } });
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: "not yet" });
  }
  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  await h.tick();
  assert.deepEqual(Object.keys(incidentsOf(h.project.state)), [], "an incident about a seat that has gone is one nobody can close");
  h.runtime.dispose();
});
