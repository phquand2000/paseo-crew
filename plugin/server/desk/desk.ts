import type { Team } from "../catalog/team.ts";
import { type Kit, seatOf } from "../catalog/kit.ts";
import type { SeatView, Seats, Workspaces } from "../core/ports.ts";
import { Agents } from "./agents.ts";
import { type Args, type Caller, type CodeIndex, DeskContext, type Mailer, type ToolReply, type ToolRequest, errorText, no } from "./context.ts";
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

const TOOLS: Record<string, Tool> = {
  "supervisor.open_lane": supervisor.openLane,
  "supervisor.close_lane": supervisor.closeLane,
  "supervisor.set_project": supervisor.setProject,
  "supervisor.message": shared.message,
  "supervisor.answer": shared.answer,
  "supervisor.status": shared.status,
  "lead.start_task": lead.startTask,
  "lead.start_review": lead.startReview,
  "lead.accept": lead.accept,
  "lead.rework": lead.rework,
  "lead.cut": lead.cut,
  "lead.ask": lead.ask,
  "lead.report": lead.report,
  "lead.message": shared.message,
  "lead.answer": shared.answer,
  "lead.status": shared.status,
  "peer.done": worker.done,
  "peer.ask": worker.ask,
  "reviewer.done": worker.done,
  "reviewer.ask": worker.ask,
  "watcher.raise": watcher.raise,
};

export type DeskOptions = {
  kit: Kit;
  outbox: Mailer;
  seats: Seats;
  workspaces: Workspaces;
  log: (project: Project, line: string) => void;
  teamFor: (project?: Project) => Team;
  indexesFor?: (project: Project) => CodeIndex[];
};

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

  post(to: string | undefined, key: string, text: string): Promise<void> {
    return this.services.ctx.post(to, key, text);
  }

  supervisorFor(project: Project, preferred?: string): Promise<string | undefined> {
    return this.services.roster.supervisorFor(project, preferred);
  }

  archive(agentId: string | undefined, force = false): Promise<void> {
    return this.services.roster.archive(agentId, force);
  }

  recordReading(project: Project, where: string, notes: string[]): void {
    this.services.ctx.recordReading(project, where, notes);
  }

  setTask(project: Project, taskId: string, change: (task: Task) => void): Promise<Task | undefined> {
    return this.services.ctx.setTask(project, taskId, change);
  }

  async ensureWatcher(project: Project, seats: Iterable<SeatView>): Promise<string | undefined> {
    const seated = this.services.roster.watcherSeat(project, seats);
    if (seated) return seated;
    return this.services.agents.startResident(project, "watcher", {
      title: `Watcher ${project.slug}`,
      prompt: "You are seated on this project. Turn endings arrive as mail; label each one and raise what is not normal. Nothing to do until mail arrives.",
      labels: { "seatworks.role": "watcher" },
    });
  }

  async handle(request: ToolRequest): Promise<ToolReply> {
    const caller = await this.caller(request);
    if ("error" in caller) return no(caller.error);
    const { ctx } = this.services;
    const tool = TOOLS[`${caller.team}.${request.tool}`];
    let reply: ToolReply;
    try {
      reply = tool ? await tool(this.services, caller, (request.args ?? {}) as Args) : no(`Unknown tool ${request.tool}.`);
    } catch (error) {
      ctx.log(caller.project, `${caller.team} ${caller.id} ${request.tool} crashed: ${errorText(error)}`);
      reply = no(`${request.tool} failed: ${errorText(error)}`);
    }
    ctx.event(caller.project, { kind: "tool", agent: caller.id, role: caller.team, tool: request.tool, ok: reply.ok, reply: clip(reply.text, 300) });
    if (reply.ok) {
      await ctx.ledger(caller.project, (ledger) => {
        const ref = ledger.agents[caller.id] ?? { id: caller.id, role: caller.team };
        ref.recordedAt = Date.now();
        ledger.agents[caller.id] = ref;
      });
    }
    return reply;
  }

  private async caller(request: ToolRequest): Promise<Caller | { error: string }> {
    if (!request.agent) return { error: "This tool works only inside a team agent." };
    const seat = await this.services.roster.look(request.agent);
    const role = seatOf(this.services.ctx.kit, seat.provider)?.role;
    if (!role?.team) return { error: "This agent is not part of the team." };
    if (role.team !== request.role) return { error: `This agent is a ${role.team}, so ${request.role} tools are not available to it.` };
    return { id: request.agent, role, team: role.team, title: seat.title ?? request.agent, project: projectOf(seat.cwd ?? request.cwd) };
  }
}
