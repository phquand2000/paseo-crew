import type { Kit, SensorSpec } from "../catalog/kit/kit.ts";
import type { Team } from "../catalog/team/team.ts";
import { KeyedQueue } from "../core/keyed-queue.ts";
import { midTurn } from "../core/paseo.ts";
import { intentsPath } from "../core/paths.ts";
import type { Judge, SeatView, Seats, Workspaces } from "../core/ports.ts";
import type { Finding } from "../domain/incident.ts";
import type { TaskMove, TaskStatus } from "../domain/task.ts";
import type { DeskBase } from "./base.ts";
import { ToolCalls } from "./calls.ts";
import { Claims } from "./claims.ts";
import type { CodeIndex, Mailer, Posted, ToolReply, ToolRequest } from "./context.ts";
import { OwnCopy } from "./copies/own-copy.ts";
import { Slots } from "./copies/slots.ts";
import { Human } from "./human/human.ts";
import { type Letter } from "./letters/envelope.ts";
import { messageLetters } from "./letters/message-letters.ts";
import type { Project } from "./project.ts";
import { Agents } from "./seats/agents.ts";
import { markGone } from "./seats/gone.ts";
import { reapKept } from "./seats/kept.ts";
import { Roster } from "./seats/roster.ts";
import { Teardowns } from "./seats/teardown.ts";
import { turnsEnded } from "./seats/turn-ends.ts";
import type { DeskServices, ToolDef } from "./services.ts";
import { archiveFinished } from "./store/archive.ts";
import { recordEvent } from "./store/event-log.ts";
import type { DeskEvent } from "./store/events.ts";
import { IncidentStore } from "./store/incident-store.ts";
import { Intents } from "./store/intents.ts";
import type { Lane } from "../domain/lane.ts";
import type { Ledger } from "../domain/ledger.ts";
import type { Task } from "../domain/task.ts";
import { loadLedger } from "./store/ledger.ts";
import { LedgerStore, type Sync } from "./store/ledger-store.ts";
import { tidyRecords } from "./store/records.ts";
import { MergeQueue } from "./tasks/merge-queue.ts";
import { openWaiting } from "./waiting/lanes.ts";
import { startWaiting } from "./waiting/tasks.ts";
import type { Moment } from "./watch/checks.ts";
import { type Noticed, closeIncidentsOf, notice, retell } from "./watch/notice.ts";
import { Watcher } from "./watch/watcher.ts";

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

/** The desk: it builds the services every tool and flow shares, and is what the runtime, its hooks and the panel call. */
export class Desk {
  readonly projects: Map<string, Project>;
  readonly human: Human;
  readonly watcher: Watcher;
  private readonly services: DeskServices;
  private readonly intents: Intents;
  private readonly calls: ToolCalls;

  constructor(options: DeskOptions) {
    const projects = new Map<string, Project>();
    const touched = (project: Project) => {
      projects.set(project.slug, project);
    };
    const base: DeskBase = {
      kit: options.kit,
      projects,
      ledgers: new LedgerStore(touched),
      incidents: new IncidentStore(touched),
      mail: { post: async (to, letter) => (to ? options.outbox.post({ to, ...letter }) : "nobody") },
      log: options.log,
      teamFor: options.teamFor,
      indexesFor: options.indexesFor ?? (() => []),
      sensorFor: (spec, key) => options.sensor?.(spec, key),
      seating: new Claims(),
      closing: new Claims(),
      landings: new KeyedQueue(),
      lastStatus: new Map(),
    };
    this.intents = new Intents(intentsPath());
    const roster = new Roster(options.kit, options.seats, this.intents);
    const slots = new Slots(base, options.workspaces);
    const ownCopy = new OwnCopy(base, slots);
    const teardowns = new Teardowns(base, slots, ownCopy);
    const agents = new Agents(base, roster, slots, teardowns, options.workspaces);
    this.watcher = new Watcher(base, roster, agents);
    const merges = new MergeQueue(base, (project) => startWaiting(this.services, project, true));
    this.services = { ...base, roster, slots, ownCopy, teardowns, agents, merges, watcher: this.watcher };
    const mail = { intents: this.intents, post: (to: string, letter: Letter) => base.mail.post(to, letter) };
    this.calls = new ToolCalls(this.services, options.tools, mail);
    this.projects = projects;
    this.human = new Human(this.services);
  }

  transact<T>(project: Project, decide: (ledger: Ledger) => Sync<T>): T {
    return this.services.ledgers.transact(project, decide);
  }

  settled(project: Project): Promise<unknown> {
    return this.services.merges.settled(project);
  }

  event(project: Project, data: DeskEvent): void {
    recordEvent(project, data);
  }

  notice(project: Project, seat: Noticed, findings: Finding[], moment?: Moment): ReturnType<typeof notice> {
    return notice(this.services, project, seat, findings, moment);
  }

  retell(project: Project): Promise<string[]> {
    return retell(this.services, project);
  }

  /** Paseo archived a seat: its binding is let go, and a watched seat's incidents close with it. */
  archived(project: Project, seat: string, watched: boolean): void {
    markGone(this.services, project, seat);
    if (watched) closeIncidentsOf(this.services, project, seat);
  }

  post(to: string | undefined, letter: Letter): Promise<Posted | "nobody"> {
    return this.services.mail.post(to, letter);
  }

  supervisorFor(project: Project, preferred?: string): Promise<string | undefined> {
    return this.services.roster.supervisorFor(project, preferred);
  }

  readerOf(project: Project, lane: Lane | undefined): ReturnType<Roster["readerOf"]> {
    return this.services.roster.readerOf(project, lane);
  }

  archive(agentId: string | undefined, force = false): Promise<void> {
    return this.services.roster.archive(agentId, force);
  }

  archiving(agentId: string): boolean {
    return this.services.roster.archiving(agentId);
  }

  /** A seat's turn ended: finish the teardown its own writing was holding up. */
  stopped(agentId: string): Promise<void> {
    return turnsEnded(this.services, (id) => id === agentId);
  }

  /**
   * The first round after a start. The turns that ended while the plugin was down end now, so what waited on them goes
   * on, and an answer promised as mail that the stop lost is owned up to.
   */
  async resume(listed: Map<string, SeatView>): Promise<void> {
    await this.services.roster.archiveWaiting(listed);
    await turnsEnded(this.services, (id) => !midTurn(listed.get(id)?.status));
    for (const promised of this.intents.promised()) {
      if (listed.has(promised.agent))
        await this.services.mail.post(promised.agent, messageLetters.unanswered(promised));
      this.intents.kept(promised);
    }
  }

  /** The first round after a start: what the merge queue held when the plugin stopped goes through. */
  resumeMerges(project: Project): Promise<void> {
    return this.services.merges.resume(project);
  }

  /** In the round: finish a teardown whose writers are not seats any more, and put away a copy kept for a Lead that is gone. */
  reapSlots(project: Project, live: Set<string>): Promise<void> {
    return reapKept(this.services, project, live);
  }

  setTask(project: Project, taskId: string, change: (task: Task) => void): Task | undefined {
    return this.services.ledgers.setTask(project, taskId, change);
  }

  moveTask(
    project: Project,
    taskId: string,
    move: TaskMove,
    change?: (task: Task) => void,
  ): Task | TaskStatus | undefined {
    return this.services.ledgers.moveTask(project, taskId, move, change);
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
    if (dropped.length > 0) recordEvent(project, { kind: "records.tidied", files: dropped.length });
  }

  /** Whether a call from this seat is still being worked on — which is not silence. */
  inFlight(agentId: string): boolean {
    return this.calls.inFlight(agentId);
  }

  answer(request: ToolRequest, options?: Parameters<ToolCalls["answer"]>[1]): Promise<ToolReply> {
    return this.calls.answer(request, options);
  }

  mailLost(request: ToolRequest, reply: ToolReply): Promise<unknown> {
    return this.calls.mailLost(request, reply);
  }

  handle(request: ToolRequest): Promise<ToolReply> {
    return this.calls.handle(request);
  }
}
