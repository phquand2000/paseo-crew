import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type TestContext, afterEach } from "node:test";
import { fileURLToPath } from "node:url";
import { PaseoHost } from "../../server/adapters/paseo/host.ts";
import { type SensorSpec, loadKit } from "../../server/catalog/kit.ts";
import { applyModels } from "../../server/catalog/models.ts";
import { stateRoot } from "../../server/core/paths.ts";
import type { HookAgent, Judge, TimelineItem } from "../../server/core/ports.ts";
import type { DeskEvent } from "../../server/desk/events.ts";
import { loadLedger } from "../../server/desk/ledger.ts";
import { type Project, projectOf } from "../../server/desk/project.ts";
import { registerRpc } from "../../server/runtime/rpc.ts";
import { Runtime } from "../../server/runtime/runtime.ts";
import type { z } from "zod";
import { tempDir } from "../tempdir.ts";
import { FakeTimeline } from "./fake-timeline.ts";

const made: Runtime[] = [];

type Contract = { name: string; input: z.ZodType; output: z.ZodType };

/** A runtime goes with the test that made it, so nothing it still follows reaches the next test. */
afterEach(() => {
  for (const runtime of made.splice(0)) runtime.dispose();
});

export type Pending = { id: string; kind: string; name: string; title?: string; input?: Record<string, unknown> };
type Fake = {
  id: string;
  provider: string;
  cwd: string;
  title: string;
  status: string;
  archivedAt: string | null;
  updatedAt: string;
  sent: string[];
  sentIds: string[];
  steered: string[];
  interrupted: string[];
  pending: Pending[];
  answered: { requestId: string; response: { behavior: string; updatedInput?: { answers?: Record<string, string> } } }[];
  prompt?: string;
  promptId?: string;
  labels: Record<string, string>;
  workspaceId?: string;
};

function fakePaseo() {
  const agents = new Map<string, Fake>();
  const workspaces = new Map<string, string>();
  const workspaceNames = new Map<string, string>();
  const workspaceProjects = new Map<string, string>();
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
      async send(text: string, options?: { activeTurnBehavior?: string; messageId?: string }) {
        agent?.sent.push(text);
        if (options?.messageId) agent?.sentIds.push(options.messageId);
        if (options?.activeTurnBehavior === "steer") agent?.steered.push(text);
        if (options?.activeTurnBehavior === "interrupt") agent?.interrupted.push(text);
      },
      async respondToPermission({ requestId, response }: Fake["answered"][number]) {
        const at = agent?.pending.findIndex((request) => request.id === requestId) ?? -1;
        if (!agent || at < 0) throw new Error(`No pending permission request with id '${requestId}'`);
        agent.pending.splice(at, 1);
        agent.answered.push({ requestId, response });
      },
      async archive() { archiveWithChildren(id); },
    };
  };
  // Paseo 0.9.2 archives an agent's children with it, and theirs (live probe, v3 LEDGER D79).
  const archiveWithChildren = (id: string): void => {
    const agent = agents.get(id);
    if (!agent || agent.archivedAt) return;
    Object.assign(agent, { archivedAt: new Date().toISOString(), status: "closed" });
    for (const child of agents.values()) if (child.labels["paseo.parent-agent-id"] === id) archiveWithChildren(child.id);
  };
  const add = (provider: string, cwd: string, title: string, status = "idle", prompt?: string, labels: Record<string, string> = {}) => {
    const id = `agent-${++count}`;
    agents.set(id, { id, provider, cwd, title, status, archivedAt: null, updatedAt: new Date().toISOString(), sent: [], sentIds: [], steered: [], interrupted: [], pending: [], answered: [], prompt, labels });
    return id;
  };
  const workspace = (id: string) => ({
    id,
    projectId: workspaceProjects.get(id) ?? null,
    async setTitle(title: string) {
      workspaceNames.set(id, title);
      return { title };
    },
    agents: {
      async create(options: { config: { provider: string }; parent?: string; title: string; prompt: string; clientMessageId?: string; labels?: Record<string, string> }) {
        // Paseo keeps an agent's parent as this label, and never pushes an agent that has one.
        const labels = { ...options.labels, ...(options.parent ? { "paseo.parent-agent-id": options.parent } : {}) };
        const made = add(options.config.provider, workspaces.get(id)!, options.title, "running", options.prompt, labels);
        Object.assign(agents.get(made)!, { promptId: options.clientMessageId, workspaceId: id });
        return ref(made);
      },
    },
  });
  const paseo = {
    agents: {
      ref,
      // The daemon caps a page at 200 rows and reports the rest through pageInfo, so the fake does too.
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
      // The daemon files a directory under the given project, or makes one of the directory when given none.
      async create({ title, source }: { title?: string; source: { path: string; projectId?: string } }) {
        const id = `ws-${workspaces.size + 1}`;
        workspaces.set(id, source.path);
        workspaceProjects.set(id, source.projectId ?? `prj:${source.path}`);
        if (title) workspaceNames.set(id, title);
        return workspace(id);
      },
      async list() {
        return {
          entries: [...workspaces.keys()].map((id) => ({ id, projectId: workspaceProjects.get(id)!, name: workspaceNames.get(id) ?? "", archivingAt: archivedWorkspaces.has(id) ? new Date().toISOString() : null })),
          pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
        };
      },
      // The daemon archives every agent a workspace owns with it (workspace-archive-service.js, archiveWorkspaceContents).
      async archive(id: string) {
        const workspaceId = typeof id === "string" ? id : (id as { id: string }).id;
        archivedWorkspaces.add(workspaceId);
        for (const agent of agents.values()) if (agent.workspaceId === workspaceId) archiveWithChildren(agent.id);
        return { archivedAt: new Date().toISOString() };
      },
      ref: workspace,
    },
  };
  return { paseo: paseo as never, agents, add, workspaces, workspaceNames, workspaceProjects, archivedWorkspaces, timelineOf };
}

export function repo(): { root: string; git: (cwd: string, ...args: string[]) => string } {
  const root = tempDir("sw2-flow-repo-");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(root, "b.txt"), "bee\n");
  // A real one, because the desk now reads the serial-only rules against the files that exist.
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  // An IntelliJ project, which is what the index these tests fake serves.
  mkdirSync(join(root, ".idea"));
  writeFileSync(join(root, ".idea", "misc.xml"), "<project/>\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "seed");
  return { root, git };
}

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const thinking = ["low", "medium", "high"].map((id) => ({ id, label: id }));
applyModels(kit, {
  claude: { at: "", error: null, models: [{ id: "claude-opus-5", label: "Opus 5", thinkingOptions: thinking }] },
});

export const ideCalls: { kind: "open" | "sync" | "close"; path: string }[] = [];
const ide = {
  async open(path: string) {
    ideCalls.push({ kind: "open" as const, path });
    return { ok: true, text: "opened" };
  },
  async sync(path: string) {
    ideCalls.push({ kind: "sync" as const, path });
    return { ok: true, text: "synced" };
  },
  async close(path: string) {
    ideCalls.push({ kind: "close" as const, path });
    return { ok: true, text: "closed" };
  },
};

/** `sensor` stands in for the HTTP one the host gives the desk, so no test asks a real model. */
/** The events of kind `K`, a kind made from a template (merge.<status>) included. */
type EventOf<K, E = DeskEvent> = E extends { kind: infer T } ? (K extends T ? E : never) : never;

export function harness(options: { sensor?: (spec: SensorSpec, key: string) => Judge } = {}) {
  // One harness is one machine: a test that builds two gets two, since a daemon never shares its state.
  process.env.HOME = tempDir("sw2-home-");
  const { root, git } = repo();
  const state = stateRoot();
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "settings.json"), JSON.stringify({ mcp: { "intellij-index": { enabled: true }, "code-search": { enabled: true }, context7: { enabled: true } } }));
  const { paseo, agents, add, workspaces, workspaceNames, workspaceProjects, archivedWorkspaces, timelineOf } = fakePaseo();
  const project = projectOf(root);
  const start = (host = new PaseoHost(paseo)) => {
    const next = new Runtime(kit, host, { codeIndex: (proxy: { id: string; gitExclude?: string[] }) => ({ ...ide, id: proxy.id, gitExclude: proxy.gitExclude ?? [] }), reloadDaemon: async () => true, sensor: options.sensor });
    made.push(next);
    // Paseo seats a project's agents through the create hook, which records the project; the seats added here skip it.
    (next as unknown as { remember(project: Project): void }).remember(project);
    return next;
  };
  let runtime = start();
  // The plugin starting again on the same machine: the daemon, its agents and what is on disk stay, the plugin's memory does not.
  // Given a host, it starts as a reload does, without Paseo's API until a hook or a panel call hands it over.
  const restart = (host?: PaseoHost) => {
    runtime.dispose();
    runtime = start(host);
  };
  let n = 0;
  // `where` is the calling working copy, since several desk keys turned out shared between projects.
  const call = async (agent: string, role: string, tool: string, args: Record<string, unknown>, where = root) =>
    runtime.desk.handle({ id: `call-${++n}`, agent, role, tool, args, cwd: where, at: Date.now() });
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
  // A branch moved as another task's merge moves a lane: committed where it is checked out, or in a copy made for the commit.
  const commitTo = (branch: string, file: string, text: string) => {
    const where = git(root, "worktree", "list", "--porcelain").split("\n\n").find((entry) => entry.includes(`branch refs/heads/${branch}\n`));
    if (where) return commit(where.split("\n")[0]!.slice("worktree ".length), file, text);
    const copy = join(tempDir("sw2-commit-to-"), "copy");
    git(root, "worktree", "add", "-q", copy, branch);
    commit(copy, file, text);
    git(root, "worktree", "remove", "--force", copy);
  };
  const ledger = (of: Project = project) => loadLedger(of.state);
  // What the desk recorded of one kind, each line read as the event it is rather than matched as text.
  const events = <K extends DeskEvent["kind"]>(kind: K, of: Project = project): EventOf<K>[] => {
    const file = join(of.state, "events.log");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf-8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as DeskEvent).filter((event): event is EventOf<K> => event.kind === kind);
  };
  // What a seat has been sent and what waits for it: word that asks nothing rides along with its next letter.
  const heard = (id: string) => [...agents.get(id)!.sent, ...runtime.outbox.pending(id).map((letter) => letter.text)];
  const tick = (now?: number) => (runtime as unknown as { patrol: { tick(now?: number): Promise<void> } }).patrol.tick(now);
  const agentOf = (id: string): HookAgent => ({ id, provider: agents.get(id)!.provider, cwd: agents.get(id)!.cwd, title: agents.get(id)!.title });
  // Paseo fires a turn start before a turn end; without one, a turn is measured from half an hour ago.
  const beginTurn = (id: string) => runtime.turnStarted(agentOf(id));
  // Paseo hands this hook the seat's whole append-only timeline, not the turn that ended.
  const told = new Map<string, TimelineItem[]>();
  const endTurn = (id: string, text: string, ...calls: TimelineItem[]) => {
    const timeline = told.get(id) ?? [];
    timeline.push({ type: "user_message", text: "go" }, ...calls, { type: "assistant_message", text });
    told.set(id, timeline);
    return runtime.turnEnded({ agent: agentOf(id), turnId: `t-${id}-${Date.now()}`, outcome: { kind: "completed" }, timeline: [...timeline] });
  };
  const permission = (id: string, request: Pending) => runtime.permissionRequested({ agent: agentOf(id), request });
  // A panel call as the panel makes it: through its contract, and its answer, as sent, read by the schema the panel checks it with.
  const rpc = async <C extends Contract>(contract: C, input: z.input<C["input"]>): Promise<z.output<C["output"]>> => {
    let answer: (input: unknown) => unknown = () => assert.fail(`nothing serves ${contract.name}`);
    registerRpc((served, handler) => void (served.name === contract.name && (answer = handler as (input: unknown) => unknown)), runtime.control, runtime.control.human, () => {});
    const raw = await answer(contract.input.parse(input));
    const sent = JSON.parse(JSON.stringify(raw)) as unknown;
    assert.deepStrictEqual(sent, raw, `${contract.name} answered with what JSON does not carry`);
    return contract.output.parse(sent) as z.output<C["output"]>;
  };
  return {
    root,
    git,
    paseo,
    agents,
    add,
    workspaces,
    workspaceNames,
    workspaceProjects,
    archivedWorkspaces,
    get runtime() {
      return runtime;
    },
    project,
    call,
    idle,
    commit,
    commitTo,
    ledger,
    events,
    heard,
    endTurn,
    tick,
    beginTurn,
    permission,
    rpc,
    timelineOf,
    restart,
  };
}

/** A lane with its Lead and one task under way: in the lane's copy, unless `task` puts it beside others. */
export async function laneWithPeer(settings?: Record<string, unknown>, options?: Parameters<typeof harness>[0], task: Record<string, unknown> = {}) {
  const h = harness(options);
  if (settings) {
    mkdirSync(h.project.state, { recursive: true });
    writeFileSync(join(h.project.state, "settings.json"), JSON.stringify(settings));
  }
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Build", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lane = h.ledger().lanes.L1!;
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Clean build", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"], ...task }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  await h.tick();
  return { h, sup, lane, peer, timeline: h.timelineOf(peer) };
}

/** Every seat archived, as Paseo lists a machine nobody sits at any more. */
export function nobodySeated(h: ReturnType<typeof harness>): void {
  for (const agent of h.agents.values()) Object.assign(agent, { archivedAt: new Date().toISOString(), status: "closed" });
}

/** A round started and held once it has listed the seats, until `release` lets it go on to its end. */
export async function heldRound(h: ReturnType<typeof harness>, t: TestContext) {
  const desk = h.runtime.desk;
  const retell = desk.retell.bind(desk);
  let reached = () => {};
  let release = () => {};
  const inRound = new Promise<void>((resolve) => (reached = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  t.mock.method(desk, "retell", async (...args: Parameters<typeof retell>) => {
    reached();
    await held;
    return retell(...args);
  });
  const round = h.tick();
  await inRound;
  return { round, release };
}

/** A round held once the daemon has listed its seats, with that listing as it was then, until `release` lets it go on. */
export async function listedRound(h: ReturnType<typeof harness>) {
  const agents = h.paseo as { agents: { list: (options?: unknown) => Promise<unknown> } };
  const list = agents.agents.list;
  let listed = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (listed = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  agents.agents.list = async (options?: unknown) => {
    agents.agents.list = list;
    const page = await list(options);
    listed();
    await held;
    return page;
  };
  const round = h.tick();
  await reached;
  return { round, release };
}

/** The next seat created under a title like `title` is held until `release`, made first when `made`; unreleased, Paseo never answers. */
export function heldCreate(h: ReturnType<typeof harness>, title: RegExp, made = false) {
  type Create = (options: { title: string }) => Promise<unknown>;
  const paseo = h.paseo as { workspaces: { ref: (id: string) => { agents: { create: Create } } } };
  const ref = paseo.workspaces.ref;
  let armed = true;
  let started = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (started = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  paseo.workspaces.ref = (id) => {
    const workspace = ref(id);
    const create = workspace.agents.create;
    workspace.agents.create = async (options) => {
      if (!armed || !title.test(options.title)) return create(options);
      armed = false;
      const seat = made ? await create(options) : undefined;
      started();
      await held;
      return seat ?? create(options);
    };
    return workspace;
  };
  return { reached, release };
}
