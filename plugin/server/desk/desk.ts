import type { Team } from "../catalog/team.ts";
import { type Kit, type SensorSpec, schemaOf, seatOf } from "../catalog/kit.ts";
import type { Finding } from "../domain/incident.ts";
import type { TaskMove, TaskStatus } from "../domain/task.ts";
import { intentsPath } from "../core/paths.ts";
import { midTurn } from "../core/paseo.ts";
import type { Judge, SeatView, Seats, Workspaces } from "../core/ports.ts";
import { Agents } from "./agents.ts";
import type { Moment } from "./checks.ts";
import { argsProblems, shapeOf, withoutNulls } from "./args.ts";
import { sortKeys } from "../core/store.ts";
import { type Args, type Caller, type CodeIndex, DeskContext, type Mailer, type Posted, type Sync, type ToolReply, type ToolRequest, no, ok } from "./context.ts";
import { errorText } from "../core/errors.ts";
import type { DeskEvent } from "./events.ts";
import { Human } from "./human.ts";
import { type Ledger, type Task, loadLedger } from "./ledger.ts";
import { clip } from "../core/text.ts";
import { landLetters } from "./land-letters.ts";
import { type Letter, letters } from "./letters.ts";
import { Intents } from "./intents.ts";
import { tidyRecords } from "./records.ts";
import { archiveFinished } from "./archive.ts";
import { reapKept } from "./kept.ts";
import { MergeQueue } from "./merge.ts";
import { type Project, projectOf } from "./project.ts";
import { Roster } from "./roster.ts";
import { type DeskServices, type ToolDef, servedBy } from "./services.ts";
import { Slots } from "./slots.ts";
import { type Noticed, closeIncidentsOf, notice, retell } from "./notice.ts";
import { openWaiting, startWaiting } from "./waiting.ts";
import { Watcher } from "./watcher.ts";

type DeskOptions = {
  kit: Kit;
  tools: ToolDef[];
  outbox: Mailer;
  seats: Seats;
  workspaces: Workspaces;
  log: (project: Project, line: string) => void;
  teamFor: (project?: Project) => Team;
  indexesFor?: (project: Project) => CodeIndex[];
  sensor?: (spec: SensorSpec, key: string) => Judge;
};

const SPEAKS = ["done", "ask", "answer", "message", "report"];

const ANSWER_WITHIN_MS = 240_000;

export class Desk {
  readonly projects: Map<string, Project>;
  readonly human: Human;
  readonly watcher: Watcher;
  private readonly services: DeskServices;
  private readonly intents: Intents;
  private readonly tools: ToolDef[];
  /** Whether a call from this seat is still being worked on — which is not silence. */
  inFlight(agentId: string): boolean {
    return [...this.running.keys()].some((key) => key.startsWith(`${agentId}\n`));
  }

  private readonly running = new Map<string, { reply: Promise<ToolReply>; started: number }>();

  constructor(options: DeskOptions) {
    const ctx = new DeskContext({
      kit: options.kit,
      outbox: options.outbox,
      log: options.log,
      teamFor: options.teamFor,
      indexesFor: options.indexesFor ?? (() => []),
      sensor: options.sensor,
    });
    this.intents = new Intents(intentsPath());
    const roster = new Roster(options.kit, options.seats, this.intents);
    const slots = new Slots(ctx, options.workspaces);
    const agents = new Agents(ctx, roster, slots, options.workspaces);
    this.watcher = new Watcher(ctx, roster, agents);
    this.services = { ctx, roster, slots, agents, merges: new MergeQueue(ctx, agents), watcher: this.watcher };
    this.tools = options.tools;
    this.projects = ctx.projects;
    this.human = new Human(this.services);
  }

  transact<T>(project: Project, decide: (ledger: Ledger) => Sync<T>): T {
    return this.services.ctx.transact(project, decide);
  }

  settled(project: Project): Promise<unknown> {
    return this.services.merges.settled(project);
  }

  event(project: Project, data: DeskEvent): void {
    this.services.ctx.event(project, data);
  }

  notice(project: Project, seat: Noticed, findings: Finding[], moment?: Moment): ReturnType<typeof notice> {
    return notice(this.services, project, seat, findings, moment);
  }

  retell(project: Project): Promise<string[]> {
    return retell(this.services, project);
  }

  closeIncidents(project: Project, seat: string): string[] {
    return closeIncidentsOf(this.services, project, seat);
  }

  post(to: string | undefined, letter: Letter): Promise<Posted | "nobody"> {
    return this.services.ctx.post(to, letter);
  }

  supervisorFor(project: Project, preferred?: string): Promise<string | undefined> {
    return this.services.roster.supervisorFor(project, preferred);
  }

  archive(agentId: string | undefined, force = false): Promise<void> {
    return this.services.roster.archive(agentId, force);
  }

  archiving(agentId: string): boolean {
    return this.services.roster.archiving(agentId);
  }

  /** A seat's turn ended: finish the teardown its own writing was holding up. */
  stopped(agentId: string): Promise<void> {
    return this.turnsEnded((id) => id === agentId);
  }

  /**
   * The first round after a start. The turns that ended while the plugin was down end now, so what waited on them goes
   * on, and an answer promised as mail that the stop lost is owned up to.
   */
  async resume(listed: Map<string, SeatView>): Promise<void> {
    await this.services.roster.archiveWaiting(listed);
    await this.turnsEnded((id) => !midTurn(listed.get(id)?.status));
    for (const promised of this.intents.promised()) {
      if (listed.has(promised.agent)) await this.services.ctx.post(promised.agent, letters.unanswered(promised));
      this.intents.kept(promised);
    }
  }

  /** The first round after a start: what the merge queue held when the plugin stopped goes through. */
  resumeMerges(project: Project): Promise<void> {
    return this.services.merges.resume(project);
  }

  private async turnsEnded(ended: (agentId: string) => boolean): Promise<void> {
    await this.services.slots.stopped(ended);
    const { ctx } = this.services;
    for (const project of ctx.projects.values()) {
      this.services.merges.retry(project).catch((error) => ctx.log(project, `merge retry failed: ${errorText(error)}`));
      const waiting = Object.values(loadLedger(project.state).lanes).filter((lane) => lane.status === "open" && lane.landing?.writers.some(ended));
      for (const lane of waiting) {
        // Who is left is worked out where it is written: a turn that ended meanwhile must not be written back as still in the way.
        const by = ctx.transact(project, (ledger) => {
          const entry = ledger.lanes[lane.id];
          if (!entry?.landing) return undefined;
          entry.landing.writers = entry.landing.writers.filter((id) => !ended(id));
          if (entry.landing.writers.length > 0) return undefined;
          const { by } = entry.landing;
          delete entry.landing;
          return by;
        });
        if (by) await ctx.post(by, landLetters.canLand(lane));
      }
    }
  }

  /** In the round: finish a teardown whose writers are not seats any more, and put away a copy kept for a Lead that is gone. */
  reapSlots(project: Project, live: Set<string>): Promise<void> {
    return reapKept(this.services, project, live);
  }

  setTask(project: Project, taskId: string, change: (task: Task) => void): Task | undefined {
    return this.services.ctx.setTask(project, taskId, change);
  }

  moveTask(project: Project, taskId: string, move: TaskMove, change?: (task: Task) => void): Task | TaskStatus | undefined {
    return this.services.ctx.moveTask(project, taskId, move, change);
  }

  /** The patrol's net under a close or an acceptance that never got to start what waited on it; one whose start failed waits for the next. */
  async openWaiting(project: Project): Promise<void> {
    await openWaiting(this.services, project, false);
    await startWaiting(this.services, project, false);
  }

  async archiveFinished(project: Project, gone: (agentId: string) => boolean): Promise<void> {
    archiveFinished(this.services, project, gone);
  }

  async sweep(project: Project, busy = false): Promise<void> {
    await this.services.slots.sweep(project, busy);
    const dropped = tidyRecords(project.state, loadLedger(project.state));
    if (dropped.length > 0) this.services.ctx.event(project, { kind: "records.tidied", files: dropped.length });
  }

  /**
   * The seat's bridge (`mcp/team.mjs`) waits five minutes but a gate may run thirty: a call that runs long is
   * answered with what is happening and its result mailed, and the same call again while it runs joins it.
   */
  answer(request: ToolRequest, within = ANSWER_WITHIN_MS): Promise<ToolReply> {
    const key = `${request.agent}\n${request.tool}\n${JSON.stringify(sortKeys(request.args ?? {}))}`;
    const running = this.running.get(key);
    if (running) return this.inTime(request, running.reply, running.started, within, true);
    const started = Date.now();
    // A throw is answered too: only a resolved reply posts the letter the seat was promised.
    const reply = this.handle(request)
      .catch((error: unknown) => no(`The desk failed: ${errorText(error)}`))
      .finally(() => {
        if (this.running.get(key)?.started === started) this.running.delete(key);
      });
    this.running.set(key, { reply, started });
    return this.inTime(request, reply, started, within, false);
  }

  private inTime(request: ToolRequest, reply: Promise<ToolReply>, started: number, within: number, again: boolean): Promise<ToolReply> {
    return new Promise((resolve) => {
      let answered = false;
      const timer = setTimeout(() => {
        if (answered) return;
        answered = true;
        resolve(
          ok(
            again
              ? `That ${request.tool} call is already running from before. Its answer arrives as mail; there is nothing to call again.`
              : `The desk is still working on ${request.tool} — a gate can take as long as the project allows it. The answer arrives as mail. End your turn now; do not call ${request.tool} again.`,
          ),
        );
        // One letter for one run, whichever of its callers gave up waiting first; kept on disk until it is posted.
        const promised = { agent: request.agent, tool: request.tool, started };
        this.intents.promise(promised);
        void reply.then(async (done) => {
          await this.services.ctx.post(request.agent, letters.later(promised, done));
          this.intents.kept(promised);
        });
      }, within);
      timer.unref?.();
      void reply.then((done) => {
        if (answered) return;
        answered = true;
        clearTimeout(timer);
        resolve(done);
      });
    });
  }

  async handle(request: ToolRequest): Promise<ToolReply> {
    const caller = await this.caller(request);
    if ("error" in caller) return no(caller.error);
    const { ctx } = this.services;
    const shown = schemaOf(ctx.kit, caller.role, request.tool);
    const tool = shown ? servedBy(this.tools, request.tool, shown) : undefined;
    const args = (request.args ?? {}) as Args;
    const problems = shown ? argsProblems(shown, args) : [];
    let reply: ToolReply;
    try {
      reply = !tool
        ? no(`Unknown tool ${request.tool}.`)
        : problems.length > 0
          ? no(`${request.tool} was not carried out: it ${problems.join("; ")}. ${shapeOf(shown!)}`)
          : await tool.handle(this.services, caller, tool.input.parse(withoutNulls(args)));
    } catch (error) {
      ctx.log(caller.project, `${caller.role.role} ${caller.id} ${request.tool} crashed: ${errorText(error)}`);
      reply = no(`${request.tool} failed: ${errorText(error)}`);
    }
    ctx.event(caller.project, { kind: "tool", agent: caller.id, role: caller.role.role, tool: request.tool, ok: reply.ok, reply: clip(reply.text, 300) });
    if (reply.ok) {
      // Noting that the seat was heard from must not turn a reply it has earned into a crash.
      try {
        ctx.transact(caller.project, (ledger) => {
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
