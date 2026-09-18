import type { Team } from "../catalog/team.ts";
import { type Kit, type RoleSpec, can, roleThatCan, seatOf, toolsOf } from "../catalog/kit.ts";
import type { SeatView, Seats, Workspaces } from "../core/ports.ts";
import { Agents } from "./agents.ts";
import { type Args, type Caller, type CodeIndex, DeskContext, type Mailer, type Posted, type ToolReply, type ToolRequest, errorText, no } from "./context.ts";
import type { Ledger, Task } from "./ledger.ts";
import { clip } from "./letters.ts";
import { MergeQueue } from "./merge.ts";
import { type Project, projectOf } from "./project.ts";
import { Roster } from "./roster.ts";
import type { DeskServices, Tool } from "./services.ts";
import { Slots } from "./slots.ts";
import * as lead from "./tools/lead.ts";
import * as shared from "./tools/shared.ts";
import * as supervisor from "./tools/supervisor.ts";
import * as watcher from "./tools/watcher.ts";
import * as worker from "./tools/worker.ts";
import type { Watching } from "./watching.ts";

const TOOLS: Record<string, Tool> = {
  open_lane: supervisor.openLane,
  close_lane: supervisor.closeLane,
  set_project: supervisor.setProject,
  start_task: lead.startTask,
  start_review: lead.startReview,
  accept: lead.accept,
  rework: lead.rework,
  cut: lead.cut,
  report: lead.report,
  done: worker.done,
  raise: watcher.raise,
  message: shared.message,
  answer: shared.answer,
  status: shared.status,
};

// "ask" means one thing to every seat that holds it — reach the seat above me — and only what is above differs.
const ASK: { capability: string; tool: Tool }[] = [
  { capability: "lead", tool: lead.ask },
  { capability: "work", tool: worker.ask },
];

function toolFor(role: RoleSpec, name: string): Tool | undefined {
  return name === "ask" ? ASK.find((entry) => can(role, entry.capability))?.tool : TOOLS[name];
}

export type DeskOptions = {
  kit: Kit;
  outbox: Mailer;
  seats: Seats;
  workspaces: Workspaces;
  log: (project: Project, line: string) => void;
  teamFor: (project?: Project) => Team;
  indexesFor?: (project: Project) => CodeIndex[];
};

/** Tools whose whole point is that somebody else reads the result. Reading the room is not speaking. */
const SPEAKS = ["done", "ask", "answer", "message", "report", "raise"];

export class Desk {
  readonly projects: Map<string, Project>;
  readonly pendingArchive: Set<string>;
  private readonly services: DeskServices;

  constructor(options: DeskOptions) {
    const ctx = new DeskContext({
      kit: options.kit,
      outbox: options.outbox,
      log: options.log,
      teamFor: options.teamFor,
      indexesFor: options.indexesFor ?? (() => []),
    });
    const roster = new Roster(options.kit, options.seats);
    const slots = new Slots(ctx, options.workspaces);
    const agents = new Agents(ctx, roster, slots, options.workspaces);
    this.services = { ctx, roster, slots, agents, merges: new MergeQueue(ctx, agents) };
    this.projects = ctx.projects;
    this.pendingArchive = roster.pendingArchive;
  }

  ledger<T>(project: Project, change: (ledger: Ledger) => T | Promise<T>): Promise<T> {
    return this.services.ctx.ledger(project, change);
  }

  settled(project: Project): Promise<unknown> {
    return this.services.merges.settled(project);
  }

  event(project: Project, data: Record<string, unknown>): void {
    this.services.ctx.event(project, data);
  }

  /** The strike table under its own lock, so the patrol's settle cannot be overwritten by a `raise`. */
  watching<T>(project: Project, change: (watching: Watching) => { save: Watching; result: T }): Promise<T> {
    return this.services.ctx.watching(project, change);
  }

  post(to: string | undefined, key: string, text: string): Promise<Posted | "nobody"> {
    return this.services.ctx.post(to, key, text);
  }

  supervisorFor(project: Project, preferred?: string): Promise<string | undefined> {
    return this.services.roster.supervisorFor(project, preferred);
  }

  archive(agentId: string | undefined, force = false): Promise<void> {
    return this.services.roster.archive(agentId, force);
  }

  /** A seat's turn ended: finish the teardown its own writing was holding up. */
  stopped(agentId: string): Promise<void> {
    return this.services.slots.stopped(agentId);
  }

  /** In the round: finish a teardown whose writers are not seats any more. */
  reapSlots(project: Project, live: Set<string>): Promise<void> {
    return this.services.slots.reap(project, live);
  }

  recordReading(project: Project, where: string, notes: string[]): void {
    this.services.ctx.recordReading(project, where, notes);
  }

  setTask(project: Project, taskId: string, change: (task: Task) => void): Promise<Task | undefined> {
    return this.services.ctx.setTask(project, taskId, change);
  }

  sweep(project: Project, busy = false): Promise<void> {
    return this.services.slots.sweep(project, busy);
  }

  retireWatcher(project: Project, seats?: Iterable<SeatView>, now = false): Promise<void> {
    return this.services.roster.retireWatcher(project, seats, now);
  }

  async ensureWatcher(project: Project, seats: Iterable<SeatView>): Promise<string | undefined> {
    const seated = this.services.roster.watcherSeat(project, seats);
    if (seated) return seated;
    const role = roleThatCan(this.services.ctx.kit, "watch");
    if (!role) return undefined;
    return this.services.agents.startResident(project, role.role, {
      title: `${role.label} ${project.slug}`,
      prompt: `You are seated on this project as its ${role.label}. Mail arrives when there is something to read; there is nothing to do until it does.`,
      labels: { "seatworks.role": role.role, ...(role.concern ? { "seatworks.concern": role.concern } : {}) },
    });
  }

  async handle(request: ToolRequest): Promise<ToolReply> {
    const caller = await this.caller(request);
    if ("error" in caller) return no(caller.error);
    const { ctx } = this.services;
    const held = toolsOf(this.services.ctx.kit, caller.role).includes(request.tool);
    const tool = held ? toolFor(caller.role, request.tool) : undefined;
    let reply: ToolReply;
    try {
      reply = tool ? await tool(this.services, caller, (request.args ?? {}) as Args) : no(`Unknown tool ${request.tool}.`);
    } catch (error) {
      ctx.log(caller.project, `${caller.role.role} ${caller.id} ${request.tool} crashed: ${errorText(error)}`);
      reply = no(`${request.tool} failed: ${errorText(error)}`);
    }
    ctx.event(caller.project, { kind: "tool", agent: caller.id, role: caller.role.role, tool: request.tool, ok: reply.ok, reply: clip(reply.text, 300) });
    if (reply.ok) {
      // Noting that the seat was heard from must not turn a reply it has earned into a crash.
      try {
        await ctx.ledger(caller.project, (ledger) => {
          const ref = ledger.agents[caller.id] ?? { id: caller.id, role: caller.role.role };
          ref.recordedAt = Date.now();
          if (SPEAKS.includes(request.tool)) ref.spokeAt = ref.recordedAt;
          ledger.agents[caller.id] = ref;
        });
      } catch (error) {
        ctx.log(caller.project, `could not record that ${caller.id} was heard from: ${errorText(error)}`);
      }
    }
    return reply;
  }

  private async caller(request: ToolRequest): Promise<Caller | { error: string }> {
    if (!request.agent) return { error: "This tool works only inside a team agent." };
    const seat = await this.services.roster.look(request.agent);
    const role = seatOf(this.services.ctx.kit, seat.provider)?.role;
    if (!role?.tools) return { error: "This agent is not part of the team." };
    if (role.role !== request.role) return { error: `This agent is a ${role.label}, so ${request.role} tools are not available to it.` };
    return { id: request.agent, role, title: seat.title ?? request.agent, project: projectOf(seat.cwd ?? request.cwd) };
  }
}
