import type { Team } from "../catalog/team.ts";
import { type Kit, seatOf } from "../catalog/kit.ts";
import type { PaseoApi, SeatView } from "../core/paseo.ts";
import { Agents } from "./agents.ts";
import { type Args, type Caller, type CodeIndex, DeskContext, type Mailer, type ToolReply, type ToolRequest, errorText, no } from "./context.ts";
import type { Ledger, Task } from "./ledger.ts";
import { clip } from "./letters.ts";
import { MergeQueue } from "./merge.ts";
import { type Project, projectOf } from "./project.ts";
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

export class Desk {
  readonly projects: Map<string, Project>;
  readonly pendingArchive: Set<string>;
  private readonly services: DeskServices;

  constructor(kit: Kit, outbox: Mailer, log: (project: Project, line: string) => void, teamFor: (project?: Project) => Team, indexesFor: (project: Project) => CodeIndex[] = () => []) {
    const ctx = new DeskContext({ kit, outbox, log, teamFor, indexesFor });
    const slots = new Slots(ctx);
    const agents = new Agents(ctx, slots);
    this.services = { ctx, slots, agents, merges: new MergeQueue(ctx, agents) };
    this.projects = ctx.projects;
    this.pendingArchive = ctx.pendingArchive;
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

  post(paseo: PaseoApi, to: string | undefined, key: string, text: string): Promise<void> {
    return this.services.ctx.post(paseo, to, key, text);
  }

  supervisorFor(paseo: PaseoApi, project: Project, preferred?: string): Promise<string | undefined> {
    return this.services.ctx.supervisorFor(paseo, project, preferred);
  }

  archive(paseo: PaseoApi, agentId: string | undefined, force = false): Promise<void> {
    return this.services.ctx.archive(paseo, agentId, force);
  }

  setTask(project: Project, taskId: string, change: (task: Task) => void): Promise<Task | undefined> {
    return this.services.ctx.setTask(project, taskId, change);
  }

  async ensureWatcher(paseo: PaseoApi, project: Project, seats: Iterable<SeatView>): Promise<string | undefined> {
    const kit = this.services.ctx.kit;
    for (const seat of seats) {
      if (seatOf(kit, seat.provider)?.role.team === "watcher" && seat.cwd === project.root) return seat.id;
    }
    return this.services.agents.startResident(paseo, project, "watcher", {
      title: `Watcher ${project.slug}`,
      prompt: "You are seated on this project. Turn endings arrive as mail; label each one and raise what is not normal. Nothing to do until mail arrives.",
      labels: { "seatworks.role": "watcher" },
    });
  }

  async handle(paseo: PaseoApi, request: ToolRequest): Promise<ToolReply> {
    const caller = await this.caller(paseo, request);
    if ("error" in caller) return no(caller.error);
    const { ctx } = this.services;
    const tool = TOOLS[`${caller.team}.${request.tool}`];
    let reply: ToolReply;
    try {
      reply = tool ? await tool(this.services, paseo, caller, (request.args ?? {}) as Args) : no(`Unknown tool ${request.tool}.`);
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

  private async caller(paseo: PaseoApi, request: ToolRequest): Promise<Caller | { error: string }> {
    if (!request.agent) return { error: "This tool works only inside a team agent." };
    const handle = paseo.agents.ref(request.agent);
    await handle.refresh();
    const snapshot = handle.current();
    const role = seatOf(this.services.ctx.kit, snapshot?.provider)?.role;
    if (!snapshot || !role?.team) return { error: "This agent is not part of the team." };
    if (role.team !== request.role) return { error: `This agent is a ${role.team}, so ${request.role} tools are not available to it.` };
    return { id: request.agent, role, team: role.team, title: snapshot.title ?? request.agent, project: projectOf(snapshot.cwd ?? request.cwd) };
  }
}
