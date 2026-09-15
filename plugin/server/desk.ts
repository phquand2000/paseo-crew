import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runGate } from "./gate.ts";
import {
  addWorktree,
  branchExists,
  commitsAhead,
  currentBranch,
  diffCounts,
  git,
  headSha,
  isPristine,
  landLane,
  mergeBranch,
  outsideOwned,
  resetHard,
} from "./git.ts";
import { type Ide, excludeIdeFiles } from "./ide.ts";
import { fetchIssue, type Issue } from "./issue.ts";
import { type Kit, type RoleSpec, type TeamRole, providerId, roleWithTeam, seatOf } from "./kit.ts";
import type { Team } from "./team.ts";
import {
  type Ask,
  type AskKind,
  type Lane,
  type Ledger,
  type Slot,
  type Task,
  type TaskStatus,
  activeTasks,
  findLane,
  findTask,
  laneOfLead,
  loadLedger,
  nextAskId,
  nextLaneId,
  nextTaskId,
  saveLedger,
  slugify,
  taskOfPeer,
} from "./ledger.ts";
import { clip, letters } from "./letters.ts";
import type { Outbox, PaseoApi } from "./outbox.ts";
import { worktreeRoot } from "./paths.ts";
import { type Project, detectGate, loadConfig, projectOf, saveConfig } from "./project.ts";
import { firstOverlap, serialHits } from "./scope.ts";
import type { ToolReply, ToolRequest } from "./spool.ts";
import { type SeatView, statusText } from "./status.ts";

type Args = Record<string, unknown>;
type Caller = { id: string; role: RoleSpec; team: TeamRole; title: string; project: Project };
type Holder = { lane?: string; task?: string };

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strs = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : typeof value === "string" && value.trim() ? [value.trim()] : [];
const ok = (text: string): ToolReply => ({ ok: true, text });
const no = (text: string): ToolReply => ({ ok: false, text });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const WRITING: TaskStatus[] = ["running", "rework"];

export const hash = (...parts: string[]) => createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 12);

export class Desk {
  readonly projects = new Map<string, Project>();
  readonly pendingArchive = new Set<string>();
  private readonly kit: Kit;
  private readonly outbox: Outbox;
  private readonly logLine: (project: Project, line: string) => void;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly merges = new Map<string, Promise<unknown>>();
  private readonly teamFor: (project?: Project) => Team;
  private readonly ideFor: (project: Project) => Ide | null;

  constructor(kit: Kit, outbox: Outbox, log: (project: Project, line: string) => void, teamFor: (project?: Project) => Team, ideFor: (project: Project) => Ide | null = () => null) {
    this.kit = kit;
    this.outbox = outbox;
    this.logLine = log;
    this.teamFor = teamFor;
    this.ideFor = ideFor;
  }

  ledger<T>(project: Project, change: (ledger: Ledger) => T | Promise<T>): Promise<T> {
    this.projects.set(project.slug, project);
    const previous = this.locks.get(project.slug) ?? Promise.resolve();
    const run = previous.then(async () => {
      const ledger = loadLedger(project.state);
      const result = await change(ledger);
      saveLedger(project.state, ledger);
      return result;
    });
    this.locks.set(project.slug, run.catch(() => undefined));
    return run;
  }

  settled(project: Project): Promise<unknown> {
    return this.merges.get(project.slug) ?? Promise.resolve();
  }

  event(project: Project, data: Record<string, unknown>): void {
    try {
      mkdirSync(project.state, { recursive: true });
      appendFileSync(join(project.state, "events.log"), `${JSON.stringify({ at: new Date().toISOString(), ...data })}\n`);
    } catch (error) {
      console.error("seatworks-v2: events.log write failed:", error);
    }
  }

  async post(paseo: PaseoApi, to: string | undefined, key: string, text: string): Promise<void> {
    if (!to) return;
    await this.outbox.post(paseo, { to, key, text });
  }

  async supervisorFor(paseo: PaseoApi, project: Project, preferred?: string): Promise<string | undefined> {
    if (preferred) {
      try {
        const handle = paseo.agents.ref(preferred);
        await handle.refresh();
        if (!handle.archivedAt) return preferred;
      } catch {}
    }
    const { entries } = await paseo.agents.list({ filter: { includeArchived: false } });
    const found = entries
      .map((entry) => entry.agent as unknown as SeatView)
      .filter((seat) => !seat.archivedAt && seatOf(this.kit, seat.provider)?.role.team === "supervisor" && projectOf(seat.cwd).slug === project.slug)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return found[0]?.id ?? preferred;
  }

  async archive(paseo: PaseoApi, agentId: string | undefined, force = false): Promise<void> {
    if (!agentId) return;
    try {
      const handle = paseo.agents.ref(agentId);
      if (!force) {
        await handle.refresh();
        if (handle.status === "running" || handle.status === "initializing") {
          this.pendingArchive.add(agentId);
          return;
        }
      }
      this.pendingArchive.delete(agentId);
      await handle.archive();
    } catch (error) {
      console.error(`seatworks-v2: archiving ${agentId} failed:`, error);
    }
  }

  async setTask(project: Project, taskId: string, change: (task: Task) => void): Promise<Task | undefined> {
    return this.ledger(project, (ledger) => {
      const task = ledger.tasks[taskId];
      if (!task) return undefined;
      change(task);
      task.updatedAt = Date.now();
      return { ...task };
    });
  }

  async retire(paseo: PaseoApi, project: Project, task: Task, dropBranch = false): Promise<void> {
    await this.archive(paseo, task.peer);
    if (task.kind === "code" && task.mode === "parallel") await this.releaseSlot(project, task.slot, dropBranch ? task.branch : undefined);
  }

  private async acquireSlot(paseo: PaseoApi, project: Project, branch: string, base: string, holder: Holder): Promise<Slot> {
    const picked = await this.ledger(project, (ledger) => {
      const free = Object.values(ledger.slots)
        .filter((slot) => !slot.lane && !slot.task)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (free) {
        Object.assign(free, holder);
        return { ...free };
      }
      const count = Object.keys(ledger.slots).length;
      if (count >= this.teamFor(project).limits.slots) return undefined;
      const id = `S${count}`;
      const slot: Slot = { id, path: join(worktreeRoot(), project.slug, id), createdAt: Date.now(), ...holder };
      ledger.slots[id] = slot;
      return { ...slot };
    });
    if (!picked) throw new Error(`all ${this.teamFor(project).limits.slots} working copies of this project are in use`);
    try {
      if (!(await branchExists(project.root, base))) throw new Error(`the base branch ${base} does not exist`);
      if (await branchExists(project.root, branch)) throw new Error(`the branch ${branch} already exists`);
      const reused = existsSync(join(picked.path, ".git"));
      if (reused) {
        if (!(await isPristine(picked.path))) throw new Error(`working copy ${picked.id} has uncommitted changes`);
        const run = await git(picked.path, ["switch", "-c", branch, base]);
        if (run.code !== 0) throw new Error(run.stderr.trim() || "git switch failed");
      } else {
        mkdirSync(dirname(picked.path), { recursive: true });
        const added = await addWorktree(project.root, picked.path, branch, base);
        if (!added.ok) throw new Error(added.message);
      }
      let workspaceId = picked.workspaceId;
      if (!workspaceId) {
        const workspace = await paseo.workspaces.create({ title: `${project.slug} ${picked.id}`, source: { kind: "directory", path: picked.path } });
        workspaceId = workspace.id;
        await this.ledger(project, (ledger) => {
          const slot = ledger.slots[picked.id];
          if (slot) slot.workspaceId = workspaceId;
        });
      }
      this.event(project, { kind: "slot.taken", slot: picked.id, branch, ...holder });
      this.indexSlot(project, picked, reused);
      return { ...picked, workspaceId };
    } catch (error) {
      await this.ledger(project, (ledger) => {
        const slot = ledger.slots[picked.id];
        if (slot) {
          delete slot.lane;
          delete slot.task;
        }
      });
      throw error;
    }
  }

  private indexSlot(project: Project, slot: Slot, reused: boolean): void {
    const ide = this.ideFor(project);
    if (!ide) return;
    excludeIdeFiles(project.root);
    const work = ide.open(slot.path).then((opened) => (opened.ok && reused ? ide.sync(slot.path) : opened));
    void work.then((result) => this.event(project, { kind: "ide.opened", slot: slot.id, reused, ok: result.ok, detail: clip(result.text, 200) }));
  }

  private async releaseSlot(project: Project, slotId: string | undefined, dropBranch?: string): Promise<void> {
    if (!slotId) return;
    const slot = loadLedger(project.state).slots[slotId];
    if (slot && existsSync(slot.path)) {
      await git(slot.path, ["switch", "--detach"]);
      if (dropBranch) await git(project.root, ["branch", "-D", dropBranch]);
    }
    await this.ledger(project, (ledger) => {
      const entry = ledger.slots[slotId];
      if (entry) {
        delete entry.lane;
        delete entry.task;
      }
    });
    this.event(project, { kind: "slot.released", slot: slotId });
  }

  async handle(paseo: PaseoApi, request: ToolRequest): Promise<ToolReply> {
    const caller = await this.caller(paseo, request);
    if ("error" in caller) return no(caller.error);
    const args = (request.args ?? {}) as Args;
    let reply: ToolReply;
    try {
      reply = await this.route(paseo, caller, request.tool, args);
    } catch (error) {
      this.logLine(caller.project, `${caller.team} ${caller.id} ${request.tool} crashed: ${message(error)}`);
      reply = no(`${request.tool} failed: ${message(error)}`);
    }
    this.event(caller.project, { kind: "tool", agent: caller.id, role: caller.team, tool: request.tool, ok: reply.ok, reply: clip(reply.text, 300) });
    if (reply.ok) {
      await this.ledger(caller.project, (ledger) => {
        const ref = ledger.agents[caller.id] ?? { id: caller.id, role: caller.team };
        ref.recordedAt = Date.now();
        ledger.agents[caller.id] = ref;
      });
    }
    return reply;
  }

  private async caller(paseo: PaseoApi, request: ToolRequest): Promise<Caller | { error: string }> {
    if (!request.agent) return { error: "This tool works only inside a team agent." };
    const handle = paseo.agents.ref(request.agent);
    await handle.refresh();
    const snapshot = handle.current();
    const role = seatOf(this.kit, snapshot?.provider)?.role;
    if (!snapshot || !role?.team) return { error: "This agent is not part of the team." };
    if (role.team !== request.role) return { error: `This agent is a ${role.team}, so ${request.role} tools are not available to it.` };
    return { id: request.agent, role, team: role.team, title: snapshot.title ?? request.agent, project: projectOf(snapshot.cwd ?? request.cwd) };
  }

  private route(paseo: PaseoApi, caller: Caller, tool: string, args: Args): Promise<ToolReply> {
    switch (`${caller.team}.${tool}`) {
      case "supervisor.open_lane":
        return this.openLane(paseo, caller, args);
      case "supervisor.message":
      case "lead.message":
        return this.message(paseo, caller, args);
      case "supervisor.answer":
      case "lead.answer":
        return this.answer(paseo, caller, args);
      case "supervisor.close_lane":
        return this.closeLane(paseo, caller, args);
      case "supervisor.set_project":
        return this.setProject(caller, args);
      case "supervisor.status":
      case "lead.status":
        return this.status(paseo, caller);
      case "lead.start_task":
        return this.startTask(paseo, caller, args);
      case "lead.start_review":
        return this.startReview(paseo, caller, args);
      case "lead.accept":
        return this.accept(paseo, caller, args);
      case "lead.rework":
        return this.rework(paseo, caller, args);
      case "lead.cut":
        return this.cut(paseo, caller, args);
      case "lead.ask":
        return this.leadAsk(paseo, caller, args);
      case "lead.report":
        return this.report(paseo, caller, args);
      case "peer.done":
      case "reviewer.done":
        return this.done(paseo, caller, args);
      case "peer.ask":
      case "reviewer.ask":
        return this.peerAsk(paseo, caller, args);
      default:
        return Promise.resolve(no(`Unknown tool ${tool}.`));
    }
  }

  private async startAgent(
    paseo: PaseoApi,
    project: Project,
    slot: Pick<Slot, "path" | "workspaceId">,
    team: TeamRole,
    options: { parent: string; title: string; prompt: string; labels: Record<string, string> },
  ): Promise<string> {
    const role = roleWithTeam(this.kit, team);
    if (!role) throw new Error(`roles.json has no role for ${team}`);
    if (!slot.workspaceId) throw new Error("the working copy has no workspace");
    const seat = this.teamFor(project).roles[role.role];
    if (!seat) throw new Error(`the team settings leave the ${role.label} without a harness`);
    const provider = providerId(this.kit, role.role, seat.harness.id);
    const config: Record<string, unknown> = { provider: seat.model ? `${provider}/${seat.model.id}` : provider };
    if (seat.harness.provider.profileModeId) config.modeId = seat.harness.provider.profileModeId;
    if (seat.thinking) config.thinkingOptionId = seat.thinking;
    const handle = await paseo.workspaces.ref(slot.workspaceId).agents.create({
      config: config as never,
      parent: options.parent,
      title: options.title.slice(0, 60),
      prompt: options.prompt,
      labels: { ...options.labels, "seatworks.project": project.slug },
    });
    await handle.refresh();
    const actual = handle.cwd ?? handle.current()?.cwd;
    if (actual && actual !== slot.path) {
      await this.archive(paseo, handle.id, true);
      throw new Error(`the agent was placed in ${actual} instead of ${slot.path}`);
    }
    return handle.id;
  }

  private async openLane(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const title = str(args.title);
    const outcome = str(args.outcome);
    const acceptance = strs(args.acceptance);
    if (!title || !outcome || acceptance.length === 0) return no("open_lane needs a title, an outcome and at least one acceptance check.");
    const { project } = caller;
    const config = loadConfig(project.state);
    const base = str(args.base) || config.base || (await currentBranch(project.root)) || "main";
    if (!(await branchExists(project.root, base))) return no(`The base branch ${base} does not exist.`);
    if (!config.base || !config.gate) saveConfig(project.state, { ...config, base: config.base ?? base, gate: config.gate ?? detectGate(project.root) });
    const writeSet = strs(args.writeSet);
    const contracts = strs(args.contracts);
    const open = Object.values(loadLedger(project.state).lanes).filter((lane) => lane.status === "open");
    if (open.length >= config.parallelLanes) {
      return no(
        `${open.length} lane${open.length === 1 ? " is" : "s are"} open and this project runs ${config.parallelLanes} at a time. Fold this outcome into ${open[0]?.id ?? "the open lane"} with message, wait for it to land, or raise parallelLanes with set_project only if the work is genuinely independent.`,
      );
    }
    if (open.length > 0) {
      if (writeSet.length === 0) return no("Another lane is open, so this lane needs writeSet (and contracts) to prove it doesn't overlap.");
      const serial = serialHits(writeSet, config.serialOnly);
      if (serial.length > 0) return no(`writeSet includes paths that only one lane at a time may write (${serial.join(", ")}); open this lane after the current one lands.`);
      for (const other of open) {
        if (other.writeSet.length === 0) return no(`Lane ${other.id} declared no writeSet, so it may write anywhere; open this lane after it lands.`);
        const clash = firstOverlap(writeSet, [...other.writeSet, ...other.contracts]) ?? firstOverlap(contracts, other.writeSet);
        if (clash) return no(`This lane overlaps lane ${other.id} at ${clash}; fold it in or open it after ${other.id} lands.`);
      }
    }
    let issue: Issue | undefined;
    if (str(args.issue)) {
      const fetched = await fetchIssue(str(args.issue), project.root);
      if ("error" in fetched) return no(`Issue ${str(args.issue)} could not be read: ${fetched.error}`);
      issue = fetched;
    }
    const lane = await this.ledger(project, (ledger) => {
      const id = nextLaneId(ledger);
      const entry: Lane = {
        id,
        title,
        outcome,
        acceptance,
        appetite: str(args.appetite) || undefined,
        deadline: str(args.deadline) || undefined,
        outOfScope: strs(args.outOfScope),
        issue: issue?.url,
        base,
        branch: `lane/${id.toLowerCase()}-${slugify(title, 24)}`,
        writeSet,
        contracts,
        opener: caller.id,
        status: "open",
        openedAt: Date.now(),
        tasks: 0,
      };
      ledger.lanes[id] = entry;
      return { ...entry };
    });
    const fail = async (reason: string, slot?: string) => {
      await this.ledger(project, (ledger) => {
        const entry = ledger.lanes[lane.id];
        if (entry) Object.assign(entry, { status: "closed", closedAt: Date.now() });
      });
      if (slot) await this.releaseSlot(project, slot, lane.branch);
      return no(reason);
    };
    let slot: Slot;
    try {
      slot = await this.acquireSlot(paseo, project, lane.branch, base, { lane: lane.id });
    } catch (error) {
      return fail(`The lane could not get a working copy: ${message(error)}`);
    }
    try {
      const lead = await this.startAgent(paseo, project, slot, "lead", {
        parent: caller.id,
        title: `${lane.id} ${title}`,
        prompt: letters.directive(lane, issue),
        labels: { "seatworks.lane": lane.id, "seatworks.role": "lead" },
      });
      await this.ledger(project, (ledger) => {
        const entry = ledger.lanes[lane.id];
        if (entry) Object.assign(entry, { lead, worktree: slot.path, slot: slot.id });
        ledger.agents[lead] = { id: lead, role: "lead", lane: lane.id };
      });
      this.event(project, { kind: "lane.opened", lane: lane.id, lead, branch: lane.branch, base, slot: slot.id });
      const gate = loadConfig(project.state).gate;
      const issueText = issue ? `\n\nIssue #${issue.number} as the Lead received it: ${issue.title} (${issue.url})\n<issue>\n${clip(issue.body, 4000)}\n</issue>` : "";
      return ok(
        `Lane ${lane.id} is open on ${lane.branch} (off ${base}) in working copy ${slot.id}, and its Lead ${lead} is starting. Gate: ${gate ?? "none; call set_project with the project's test command"}. Reports and asks arrive as mail; nothing to wait for now.${issueText}`,
      );
    } catch (error) {
      return fail(`The Lead could not start: ${message(error)}`, slot.id);
    }
  }

  private async message(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const to = str(args.to);
    const text = str(args.text);
    if (!to || !text) return no("message needs to and text.");
    const ledger = loadLedger(caller.project.state);
    const key = `message:${caller.id}:${hash(to, text)}`;
    if (caller.team === "supervisor") {
      const lane = findLane(ledger, to);
      if (lane) {
        if (lane.status !== "open" || !lane.lead) return no(`Lane ${lane.id} has no running Lead.`);
        await this.post(paseo, lane.lead, key, letters.message("the owner", text));
        return ok(`Queued for the Lead of ${lane.id}; it arrives when that Lead is idle.`);
      }
      const task = findTask(ledger, to);
      if (task?.peer) {
        await this.post(paseo, task.peer, key, letters.message("the project owner", text));
        await this.post(paseo, ledger.lanes[task.lane]?.lead, `copy:${key}`, letters.copied(task, text));
        return ok(`Queued for the Peer on ${task.id}; its Lead gets a copy.`);
      }
      return no(`There is no lane or task ${to}.`);
    }
    const lane = laneOfLead(ledger, caller.id);
    const task = findTask(ledger, to);
    if (!lane || !task || task.lane !== lane.id || !task.peer) return no(`${to} is not a task in your lane.`);
    await this.post(paseo, task.peer, key, letters.message("your lead", text));
    return ok(`Queued for the Peer on ${task.id}; it arrives when that Peer's turn ends.`);
  }

  private async answer(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const id = str(args.ask).toUpperCase();
    const text = str(args.text);
    if (!id || !text) return no("answer needs ask and text.");
    const result = await this.ledger(caller.project, (ledger): Ask | string => {
      const ask = ledger.asks[id];
      if (!ask) return `There is no ask ${id}.`;
      if (ask.status !== "open") return `Ask ${id} is already answered.`;
      if (ask.to !== caller.id && caller.team !== "supervisor") return `Ask ${id} was not addressed to you.`;
      ask.status = "answered";
      ask.answer = text;
      return { ...ask };
    });
    if (typeof result === "string") return no(result);
    await this.post(paseo, result.from, `answer:${result.id}`, letters.answered(result));
    this.event(caller.project, { kind: "ask.answered", ask: result.id, by: caller.id });
    return ok(`Answered ${result.id}; the asker gets it when idle.`);
  }

  private async laneGate(project: Project, lane: Lane): Promise<{ ok: boolean; text: string }> {
    const config = loadConfig(project.state);
    if (!config.gate || !lane.worktree) return { ok: true, text: "no gate set" };
    if (!(await isPristine(lane.worktree))) return { ok: false, text: "the lane working copy has uncommitted changes" };
    const logFile = join(project.state, "gates", `${lane.id}-${Date.now()}.log`);
    const result = await runGate(config.gate, lane.worktree, logFile, config.gateTimeoutMinutes * 60_000);
    this.event(project, { kind: result.ok ? "gate.passed" : "gate.failed", lane: lane.id, seconds: result.seconds });
    if (result.ok) return { ok: true, text: `${config.gate} passed on the lane branch in ${result.seconds}s` };
    const reason = result.timedOut ? `timed out after ${config.gateTimeoutMinutes} minutes` : `failed with exit ${result.code}`;
    return { ok: false, text: `${config.gate} ${reason} on the lane branch.\n\n${result.tail}\n\nFull log: ${logFile}` };
  }

  private async closeLane(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const { project } = caller;
    const lane = findLane(loadLedger(project.state), str(args.lane));
    if (!lane) return no(`There is no lane ${str(args.lane)}.`);
    if (lane.status !== "open") return no(`Lane ${lane.id} is already closed.`);
    let landing = `the branch ${lane.branch} is kept for the Human`;
    if (args.land === true) {
      const gate = await this.laneGate(project, lane);
      if (!gate.ok) return no(`Lane ${lane.id} was not closed: ${gate.text}\nMessage its Lead, or close it with land false.`);
      const result = await landLane(project.root, lane.base, lane.branch);
      landing = result.landed ? `${result.how}; ${lane.branch} is kept` : `not landed: ${result.how}; ${lane.branch} is kept for the Human`;
    }
    const retired = await this.ledger(project, (current) => {
      const entry = current.lanes[lane.id];
      if (entry) Object.assign(entry, { status: "closed", closedAt: Date.now() });
      const tasks: Task[] = [];
      for (const task of Object.values(current.tasks).filter((item) => item.lane === lane.id)) {
        if (["running", "rework", "queued", "done", "failed", "stalled"].includes(task.status)) task.status = "cut";
        tasks.push({ ...task });
      }
      return tasks;
    });
    for (const task of retired) await this.retire(paseo, project, task, task.status !== "merged");
    await this.archive(paseo, lane.lead);
    await this.releaseSlot(project, lane.slot);
    this.event(project, { kind: "lane.closed", lane: lane.id, land: args.land === true, landing, reason: str(args.reason) });
    return ok(`Lane ${lane.id} closed and its agents archived; ${landing}. Its working copy is free for the next lane.`);
  }

  private async setProject(caller: Caller, args: Args): Promise<ToolReply> {
    const config = loadConfig(caller.project.state);
    const base = str(args.base);
    if (base && !(await branchExists(caller.project.root, base))) return no(`The branch ${base} does not exist.`);
    const minutes = Number(args.gateTimeoutMinutes);
    const lanes = Number(args.parallelLanes);
    const next = {
      ...config,
      base: base || config.base,
      gate: typeof args.gate === "string" ? args.gate.trim() || undefined : config.gate,
      gateTimeoutMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : config.gateTimeoutMinutes,
      gateOn: args.gateOn === "task" ? ("task" as const) : args.gateOn === "lane" ? ("lane" as const) : config.gateOn,
      parallelLanes: Number.isInteger(lanes) && lanes > 0 ? lanes : config.parallelLanes,
      serialOnly: Array.isArray(args.serialOnly) ? strs(args.serialOnly) : config.serialOnly,
    };
    saveConfig(caller.project.state, next);
    return ok(
      `Base ${next.base ?? "unset"}; gate ${next.gate ?? "none"}, run per ${next.gateOn}; gate timeout ${next.gateTimeoutMinutes} minutes; ${next.parallelLanes} lane(s) at a time.`,
    );
  }

  private async status(paseo: PaseoApi, caller: Caller): Promise<ToolReply> {
    const ledger = loadLedger(caller.project.state);
    const { entries } = await paseo.agents.list({ filter: { includeArchived: false } });
    const seats = new Map(entries.map((entry) => [entry.agent.id, entry.agent as unknown as SeatView]));
    const lane = caller.team === "lead" ? laneOfLead(ledger, caller.id)?.id : undefined;
    return ok(statusText(caller.project, ledger, loadConfig(caller.project.state), seats, Date.now(), lane));
  }

  private async startTask(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const { project } = caller;
    const title = str(args.title);
    const goal = str(args.goal);
    const acceptance = strs(args.acceptance);
    const owned = strs(args.owned);
    const parallel = args.parallel === true;
    if (!title || !goal || acceptance.length === 0 || owned.length === 0) return no("start_task needs a title, a goal, acceptance and owned paths.");
    const ledger = loadLedger(project.state);
    const lane = laneOfLead(ledger, caller.id);
    if (!lane?.slot || !lane.worktree) return no("You have no open lane.");
    const active = activeTasks(ledger, lane.id).filter((task) => task.kind === "code");
    if (active.length >= this.teamFor(project).limits.tasksPerLane) return no(`${this.teamFor(project).limits.tasksPerLane} tasks are already active in your lane; accept, cut or wait for one first.`);
    if (!parallel) {
      const writer = active.find((task) => task.mode !== "parallel" && WRITING.includes(task.status));
      if (writer) {
        return no(`${writer.id} is still writing in the lane's working copy, and it holds one writer at a time. Wait for its hand-back, or set parallel only for owned paths independent of it.`);
      }
    } else {
      const config = loadConfig(project.state);
      const serial = serialHits(owned, config.serialOnly);
      if (serial.length > 0) return no(`A parallel task can't own ${serial.join(", ")}; run it in the lane's working copy instead.`);
      for (const task of active) {
        const clash = firstOverlap(owned, task.owned);
        if (clash) return no(`The owned paths overlap ${task.id} at ${clash}; run it after ${task.id} instead of in parallel.`);
      }
    }
    const startSha = parallel ? undefined : await headSha(lane.worktree);
    const task = await this.ledger(project, (current) => {
      const entry = current.lanes[lane.id]!;
      const id = nextTaskId(current, entry, "code");
      const now = Date.now();
      const created: Task = {
        id,
        lane: lane.id,
        kind: "code",
        mode: parallel ? "parallel" : "lane",
        title,
        goal,
        acceptance,
        owned,
        outOfScope: strs(args.outOfScope),
        context: str(args.context) || undefined,
        skills: strs(args.skills),
        branch: parallel ? `task/${id.toLowerCase()}-${slugify(title, 24)}` : lane.branch,
        worktree: parallel ? undefined : lane.worktree,
        slot: parallel ? undefined : lane.slot,
        startSha,
        status: "running",
        openedAt: now,
        updatedAt: now,
        silent: 0,
      };
      current.tasks[id] = created;
      return { ...created };
    });
    try {
      let slot: Pick<Slot, "id" | "path" | "workspaceId">;
      if (parallel) {
        slot = await this.acquireSlot(paseo, project, task.branch!, lane.branch, { task: task.id });
        await this.setTask(project, task.id, (entry) => Object.assign(entry, { slot: slot.id, worktree: slot.path }));
      } else {
        slot = loadLedger(project.state).slots[lane.slot]!;
      }
      const peer = await this.startAgent(paseo, project, slot, "peer", {
        parent: caller.id,
        title: `${task.id} ${title}`,
        prompt: letters.brief(task, lane),
        labels: { "seatworks.lane": lane.id, "seatworks.task": task.id, "seatworks.role": "peer" },
      });
      await this.setTask(project, task.id, (entry) => {
        entry.peer = peer;
      });
      await this.ledger(project, (current) => {
        current.agents[peer] = { id: peer, role: "peer", lane: lane.id, task: task.id };
      });
      this.event(project, { kind: "task.started", task: task.id, peer, mode: task.mode, slot: slot.id });
      const where = parallel ? `in its own working copy ${slot.id} on ${task.branch}` : `in the lane's working copy on ${lane.branch}`;
      return ok(`Started ${task.id} ${where} with Peer ${peer}. Its hand-back arrives as mail; there is nothing to wait for in this turn.`);
    } catch (error) {
      const failed = await this.setTask(project, task.id, (entry) => {
        entry.status = "cut";
      });
      if (failed && parallel) await this.releaseSlot(project, failed.slot, failed.branch);
      return no(`The Peer could not start: ${message(error)}`);
    }
  }

  private async startReview(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const { project } = caller;
    const focus = str(args.focus);
    if (!focus) return no("start_review needs a focus: the open question for the reviewer.");
    const ledger = loadLedger(project.state);
    const lane = laneOfLead(ledger, caller.id);
    if (!lane?.slot) return no("You have no open lane.");
    const target = str(args.task) ? findTask(ledger, str(args.task)) : undefined;
    if (str(args.task) && (!target || target.lane !== lane.id || target.kind !== "code")) return no(`${str(args.task)} is not a code task in your lane.`);
    const slotId = target?.mode === "parallel" && target.slot && ledger.slots[target.slot]?.task === target.id ? target.slot : lane.slot;
    const slot = ledger.slots[slotId];
    if (!slot) return no("The working copy for that review is gone.");
    const review = await this.ledger(project, (current) => {
      const entry = current.lanes[lane.id]!;
      const id = nextTaskId(current, entry, "review");
      const now = Date.now();
      const created: Task = {
        id,
        lane: lane.id,
        kind: "review",
        mode: "lane",
        of: target?.id,
        title: target ? `Review ${target.id}` : str(args.title) || clip(focus.split(/\r?\n/)[0] ?? "Review", 50),
        goal: focus,
        acceptance: target?.acceptance ?? [],
        owned: [],
        outOfScope: [],
        context: lane.branch,
        worktree: slot.path,
        status: "running",
        openedAt: now,
        updatedAt: now,
        silent: 0,
      };
      current.tasks[id] = created;
      return { ...created };
    });
    try {
      const reviewer = await this.startAgent(paseo, project, slot, "reviewer", {
        parent: caller.id,
        title: `${review.id} ${target?.title ?? review.title}`,
        prompt: letters.reviewBrief(review, target, focus, lane.branch),
        labels: { "seatworks.lane": lane.id, "seatworks.task": review.id, "seatworks.role": "reviewer" },
      });
      await this.setTask(project, review.id, (entry) => {
        entry.peer = reviewer;
      });
      await this.ledger(project, (current) => {
        current.agents[reviewer] = { id: reviewer, role: "reviewer", lane: lane.id, task: review.id };
      });
      this.event(project, { kind: "review.started", task: review.id, of: target?.id ?? null, reviewer });
      return ok(`Started ${review.id}${target ? ` on ${target.id}` : ""} with reviewer ${reviewer}. The verdict arrives as mail.`);
    } catch (error) {
      await this.setTask(project, review.id, (entry) => {
        entry.status = "cut";
      });
      return no(`The reviewer could not start: ${message(error)}`);
    }
  }

  private laneTask(ledger: Ledger, caller: Caller, id: string): { lane: Lane; task: Task } | string {
    const lane = laneOfLead(ledger, caller.id);
    const task = findTask(ledger, id);
    if (!lane) return "You have no open lane.";
    if (!task || task.lane !== lane.id) return `${id} is not a task in your lane.`;
    return { lane, task };
  }

  private async accept(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const { project } = caller;
    const found = this.laneTask(loadLedger(project.state), caller, str(args.task));
    if (typeof found === "string") return no(found);
    const { lane, task } = found;
    if (task.kind !== "code") return no(`${task.id} is a review; cut it when you are done with it.`);
    if (["merged", "queued", "merging", "cut"].includes(task.status)) return no(`${task.id} is ${task.status}.`);
    if (task.mode !== "parallel") {
      if (!lane.worktree || !(await isPristine(lane.worktree))) {
        return no(`The lane's working copy has uncommitted changes; send rework asking the Peer on ${task.id} to commit everything, then accept again.`);
      }
      const counts = await diffCounts(lane.worktree, task.startSha ?? lane.base, "HEAD");
      if (counts.files.length === 0) return no(`${task.id} has no commits since it started.`);
      const updated = await this.setTask(project, task.id, (entry) => {
        entry.status = "merged";
      });
      const config = loadConfig(project.state);
      const gate = config.gate ? "runs on the whole lane when you report it ready" : "none set";
      await this.post(paseo, lane.lead, `merge:${task.id}:merged:${Date.now()}`, letters.merged(task, counts, outsideOwned(counts.files, task.owned), gate));
      if (updated) await this.retire(paseo, project, updated);
      this.event(project, { kind: "task.accepted", task: task.id, mode: "lane" });
      return ok(`${task.id} is accepted; its commits are already on ${lane.branch}. The working copy is free for the next task.`);
    }
    await this.setTask(project, task.id, (entry) => {
      entry.status = "queued";
    });
    const ahead = Object.values(loadLedger(project.state).tasks).filter((entry) => entry.status === "queued" || entry.status === "merging").length - 1;
    this.enqueueMerge(paseo, project, task.id);
    return ok(`${task.id} is in the merge queue${ahead > 0 ? ` behind ${ahead}` : ""}. MERGED or MERGE FAILED arrives as mail.`);
  }

  private enqueueMerge(paseo: PaseoApi, project: Project, taskId: string): void {
    const previous = this.merges.get(project.slug) ?? Promise.resolve();
    const run = previous
      .then(() => this.merge(paseo, project, taskId))
      .catch((error) => {
        this.logLine(project, `merge ${taskId} crashed: ${message(error)}`);
        return this.setTask(project, taskId, (task) => {
          task.status = "failed";
        });
      });
    this.merges.set(project.slug, run);
  }

  private async merge(paseo: PaseoApi, project: Project, taskId: string): Promise<void> {
    const picked = await this.ledger(project, (ledger) => {
      const task = ledger.tasks[taskId];
      const lane = task ? ledger.lanes[task.lane] : undefined;
      if (!task || !lane || task.status !== "queued") return undefined;
      task.status = "merging";
      return { task: { ...task }, lane: { ...lane } };
    });
    if (!picked) return;
    const { task, lane } = picked;
    const finish = async (status: TaskStatus, text: string) => {
      await this.setTask(project, taskId, (entry) => {
        entry.status = status;
      });
      await this.post(paseo, lane.lead, `merge:${taskId}:${status}:${Date.now()}`, text);
      this.event(project, { kind: `merge.${status}`, task: taskId });
    };
    const cwd = lane.worktree;
    if (!cwd) return finish("failed", letters.mergeFailed(task, "the lane has no working copy", ""));
    if (!(await isPristine(cwd))) {
      return finish("done", letters.mergeFailed(task, "the lane's working copy has uncommitted changes from its current writer; accept again after that task hands back", ""));
    }
    if (!task.branch || (await commitsAhead(cwd, "HEAD", task.branch)) === 0) {
      return finish("failed", letters.mergeFailed(task, `${task.branch ?? "the task branch"} has no commits beyond the lane branch`, ""));
    }
    const merged = await mergeBranch(cwd, task.branch, `Merge ${task.id}: ${task.title}`);
    if (!merged.ok) {
      return merged.conflicts.length > 0
        ? finish("rework", letters.conflict(task, merged.conflicts, lane.branch))
        : finish("failed", letters.mergeFailed(task, "git merge failed", merged.message));
    }
    const counts = await diffCounts(cwd, merged.before, merged.after);
    const outside = outsideOwned(counts.files, task.owned);
    const config = loadConfig(project.state);
    let gate = config.gate ? "runs on the whole lane when you report it ready" : "none set";
    if (config.gate && config.gateOn === "task") {
      const logFile = join(project.state, "gates", `${taskId}-${Date.now()}.log`);
      const result = await runGate(config.gate, cwd, logFile, config.gateTimeoutMinutes * 60_000);
      if (!result.ok) {
        await resetHard(cwd, merged.before);
        const reason = result.timedOut ? `the gate timed out after ${config.gateTimeoutMinutes} minutes` : `the gate failed with exit ${result.code}`;
        return finish("failed", letters.mergeFailed(task, reason, result.tail, logFile));
      }
      gate = `${config.gate} passed in ${result.seconds}s`;
    }
    await finish("merged", letters.merged(task, counts, outside, gate));
    await this.retire(paseo, project, task, true);
  }

  private async rework(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const text = str(args.text);
    if (!text) return no("rework needs text saying what must change.");
    const result = await this.ledger(caller.project, (ledger): Task | string => {
      const found = this.laneTask(ledger, caller, str(args.task));
      if (typeof found === "string") return found;
      const { task } = found;
      if (["merged", "cut", "queued", "merging"].includes(task.status)) return `${task.id} is ${task.status}.`;
      task.status = "rework";
      task.silent = 0;
      task.updatedAt = Date.now();
      return { ...task };
    });
    if (typeof result === "string") return no(result);
    if (!result.peer) return no(`${result.id} has no Peer.`);
    const handle = paseo.agents.ref(result.peer);
    await handle.refresh();
    if (handle.archivedAt) return no(`The Peer on ${result.id} is gone; cut the task and start a new one.`);
    await this.post(paseo, result.peer, `rework:${result.id}:${hash(text)}`, letters.rework(text));
    return ok(`Rework sent to the Peer on ${result.id}; its next hand-back arrives as mail.`);
  }

  private async cut(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const { project } = caller;
    const found = this.laneTask(loadLedger(project.state), caller, str(args.task));
    if (typeof found === "string") return no(found);
    const { lane, task } = found;
    if (task.status === "merged") return no(`${task.id} is already accepted.`);
    const updated = await this.setTask(project, task.id, (entry) => {
      entry.status = "cut";
    });
    if (!updated) return no(`${task.id} is gone.`);
    await this.archive(paseo, task.peer, true);
    let undone = "";
    if (task.kind === "code" && task.mode === "lane" && task.startSha && lane.worktree) {
      await resetHard(lane.worktree, task.startSha);
      await git(lane.worktree, ["clean", "-fd"]);
      undone = ` The lane's working copy is back at ${task.startSha.slice(0, 7)}.`;
    }
    if (task.kind === "code" && task.mode === "parallel") await this.releaseSlot(project, task.slot, task.branch);
    this.event(project, { kind: "task.cut", task: task.id, reason: str(args.reason) });
    return ok(`${task.id} is cut and its agent stopped.${undone}`);
  }

  private async leadAsk(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const kind = str(args.kind) as AskKind;
    const text = str(args.text);
    if (!["need", "blocked", "question"].includes(kind) || !text) return no("ask needs kind (need, blocked or question) and text.");
    const lane = laneOfLead(loadLedger(caller.project.state), caller.id);
    if (!lane) return no("You have no open lane.");
    const to = await this.supervisorFor(paseo, caller.project, lane.opener);
    if (!to) return no("Nobody above you is running to answer; keep working on your default and report when the lane is ready.");
    const ask = await this.ledger(caller.project, (ledger) => {
      const entry: Ask = {
        id: nextAskId(ledger),
        from: caller.id,
        fromRole: "lead",
        to,
        lane: lane.id,
        kind,
        text,
        default: str(args.default) || undefined,
        status: "open",
        openedAt: Date.now(),
        reminders: 0,
      };
      ledger.asks[entry.id] = entry;
      return { ...entry };
    });
    await this.post(paseo, to, `ask:${ask.id}`, letters.askTo(ask, `the Lead of ${lane.id} (${lane.title})`));
    this.event(caller.project, { kind: "ask.opened", ask: ask.id, from: caller.id, to });
    return ok(`Asked as ${ask.id}. Keep working on your default where you can; the answer arrives as mail.`);
  }

  private async report(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const summary = str(args.summary);
    if (!summary) return no("report needs a summary.");
    const lane = laneOfLead(loadLedger(caller.project.state), caller.id);
    if (!lane) return no("You have no open lane.");
    if (args.ready === true) {
      const gate = await this.laneGate(caller.project, lane);
      if (!gate.ok) return no(`Not reported: the lane is not ready because ${gate.text}\nFix it with rework or start_task, then report again.`);
    }
    const to = await this.supervisorFor(paseo, caller.project, lane.opener);
    await this.post(paseo, to, `report:${lane.id}:${hash(summary)}`, letters.report(lane, summary, args.ready === true, strs(args.carried)));
    this.event(caller.project, { kind: "lane.report", lane: lane.id, ready: args.ready === true });
    return ok("Reported to the owner. Stay quiet until mail arrives.");
  }

  private async done(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const { project } = caller;
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, caller.id);
    if (!task) return no("No task is assigned to you.");
    if (["merged", "cut"].includes(task.status)) return no(`This task is already ${task.status === "merged" ? "accepted" : "cut"}; there is nothing to hand back.`);
    const lane = ledger.lanes[task.lane];
    const review = task.kind === "review";
    const outcome = review ? str(args.verdict) || "changes" : str(args.outcome) || "complete";
    const commit = review ? undefined : str(args.commit) || (task.worktree ? await headSha(task.worktree) : undefined);
    const uncommitted = !review && task.worktree ? !(await isPristine(task.worktree)) : false;
    const sections = review
      ? [`Verdict: ${outcome}`, "", str(args.findings) || "No findings given.", "", `Checks: ${str(args.checks) || "not given"}`]
      : [
          `Outcome: ${outcome}`,
          `Commit: ${commit ?? "none"}${uncommitted ? " (the working copy still has uncommitted changes)" : ""}`,
          "",
          str(args.summary) || "No summary given.",
          "",
          `Checks: ${str(args.checks) || "not given"}`,
          `Left undone: ${str(args.leftUndone) || "nothing"}`,
          `Discovered: ${str(args.discovered) || "nothing"}`,
        ];
    const body = sections.join("\n");
    const file = join(project.state, "handbacks", `${task.id}-${Date.now()}.md`);
    mkdirSync(join(project.state, "handbacks"), { recursive: true });
    writeFileSync(file, `# ${task.id} ${task.title}\n\n${body}\n`);
    await this.setTask(project, task.id, (entry) => {
      entry.status = "done";
      entry.silent = 0;
      entry.handback = { file, outcome, commit, summary: clip(str(args.summary) || str(args.findings), 400), at: Date.now() };
    });
    const heading = review ? { ...task, title: task.of ? `review of ${task.of}` : `review: ${task.title}` } : task;
    await this.post(paseo, lane?.lead, `done:${task.id}:${hash(body)}`, letters.handback(heading, file, body));
    this.event(project, { kind: review ? "review.done" : "task.done", task: task.id, outcome, commit });
    const reminder = uncommitted ? " Your working copy still has uncommitted changes: commit them before ending your turn." : "";
    return ok(`Handed back.${reminder} End your turn now; if anything changes you will get a message.`);
  }

  private async peerAsk(paseo: PaseoApi, caller: Caller, args: Args): Promise<ToolReply> {
    const question = str(args.question);
    if (!question) return no("ask needs a question.");
    const { project } = caller;
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, caller.id);
    const lane = task ? ledger.lanes[task.lane] : undefined;
    if (!task || !lane?.lead) return no("Nobody is assigned to answer you; end your turn with the question.");
    const tried = str(args.tried);
    const ask = await this.ledger(project, (current) => {
      const entry: Ask = {
        id: nextAskId(current),
        from: caller.id,
        fromRole: caller.team,
        to: lane.lead!,
        lane: lane.id,
        task: task.id,
        kind: "blocked",
        text: tried ? `${question}\n\nTried: ${tried}` : question,
        status: "open",
        openedAt: Date.now(),
        reminders: 0,
      };
      current.asks[entry.id] = entry;
      return { ...entry };
    });
    await this.post(paseo, lane.lead, `ask:${ask.id}`, letters.askTo(ask, `the Peer on ${task.id} (${task.title})`));
    this.event(project, { kind: "ask.opened", ask: ask.id, from: caller.id, to: lane.lead });
    return ok(`Asked as ${ask.id}. End your turn; the answer arrives as a message.`);
  }
}
