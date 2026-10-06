import type { HarnessSpec, Kit, RoleSpec } from "../catalog/kit/kit.ts";
import { can, seatOf, toolsOf, worksTasks } from "../catalog/kit/roles.ts";
import type { HookAgent, PermissionRequested, PermissionResolved, Seats, TurnEnded } from "../core/ports.ts";
import type { Lane } from "../domain/lane.ts";
import { DECIDED, TASK, type Task } from "../domain/task.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ledger, leadLaneOf, openAskOf, taskOfPeer, waitingOn } from "../domain/ledger.ts";
import { laneOnHold, loadLedger } from "../desk/store/ledger.ts";
import { keyOf } from "../desk/letters/envelope.ts";
import { seatLetters } from "../desk/letters/seat-letters.ts";
import { messageLetters } from "../desk/letters/message-letters.ts";
import { seatName } from "../desk/seats/names.ts";
import { type Project, projectOf } from "../desk/project/project.ts";
import type { TeamSource } from "./team-source.ts";
import { ownerOf } from "./owner.ts";
import { ProviderTrouble } from "./provider-trouble.ts";
import { clearLimited, markLimited, meanwhileRoles, wakeTime } from "./limits.ts";
import { deniedCall, lastToolCall, lastWords, limitStop, outputText, pendingJobs } from "./timeline.ts";

const QUIET = 2;

type TurnDeps = {
  kit: Kit;
  desk: Desk;
  seats: Pick<Seats, "respond">;
  source: Pick<TeamSource, "teamFor">;
  remember: (project: Project) => void;
  log: (project: Project, line: string) => void;
};

/** Where a seat puts a question instead, by the tools it holds. */
function askInstead(tools: string[]): string {
  if (tools.includes("ask_human"))
    return "put it to the Human with ask_human, or ask them in your reply and end your turn";
  return "ask it with ask, then end your turn; the answer arrives as a message";
}

export class TurnRules {
  readonly lastEnding = new Map<string, string>();
  private readonly deps: TurnDeps;
  private readonly startedAt = new Map<string, number>();
  private readonly mailed = new Set<string>();
  private readonly trouble: ProviderTrouble;

  constructor(deps: TurnDeps) {
    this.deps = deps;
    this.trouble = new ProviderTrouble(deps.desk);
  }

  /** A stalled Peer at work again runs; its count stays at the stall, so one more quiet turn stalls it without a second wake. */
  started(agent: HookAgent): void {
    this.startedAt.set(agent.id, Date.now());
    const role = seatOf(this.deps.kit, agent.provider)?.role;
    if (!role?.tools || !worksTasks(role)) return;
    const project = projectOf(agent.cwd);
    const task = taskOfPeer(loadLedger(project.state), agent.id);
    if (task?.status === "stalled")
      this.deps.desk.moveTask(project, task.id, "resume", (entry) => {
        delete entry.peerGone;
        entry.silent = Math.max(entry.silent, QUIET);
      });
  }

  forget(agentId: string): void {
    this.startedAt.delete(agentId);
    this.lastEnding.delete(agentId);
    this.trouble.forget(agentId);
    for (const key of this.mailed) if (key.startsWith(`${agentId}\n`)) this.mailed.delete(key);
  }

  /** A seat stopped on a permission: refused while its lane is on hold, else its owner is told, for the Human to give it. */
  async permission({ agent, request }: PermissionRequested): Promise<void> {
    const role = seatOf(this.deps.kit, agent.provider)?.role;
    if (!role?.tools) return;
    const project = projectOf(agent.cwd);
    const hold = laneOnHold(project.state, agent.id);
    if (hold && request.id) {
      await this.deps.seats.respond(agent.id, request.id, {
        behavior: "deny",
        message: `Lane ${hold.id} is on hold: ${hold.onHold!.reason}. Do nothing more until you are told it resumes.`,
      });
      return;
    }
    // A seat stopped on a question reads nothing, and a team waiting on a sleeping Human is stuck: the question goes by the desk.
    if (request.kind === "question" && request.id) {
      await this.deps.seats.respond(agent.id, request.id, {
        behavior: "deny",
        message: `A question that stops your turn is not taken here: ${askInstead(toolsOf(this.deps.kit, role))}.`,
      });
      return;
    }
    if (can(role, "supervise")) {
      this.deps.log(project, `waiting on the Human: ${agent.id} ${request.title ?? request.name ?? request.kind}`);
      return;
    }
    const owner = await ownerOf(this.deps.desk, project, agent.id, role);
    await this.deps.desk.post(
      owner.to,
      seatLetters.permission(agent.id, this.nameOf(project, agent, role), request, owner.reader),
    );
    if (request.id) this.mailed.add(`${agent.id}\n${request.id}`);
  }

  /** Answered in Paseo, often in the seat's own chat: its letter still held is withdrawn, and one already read is followed up. */
  async permissionResolved({ agent, requestId, resolution }: PermissionResolved): Promise<void> {
    const role = seatOf(this.deps.kit, agent.provider)?.role;
    if (!role?.tools) return;
    // Only what the desk mailed is followed up: its own refusals, and the Supervisor's own requests, told nobody.
    const told = this.mailed.delete(`${agent.id}\n${requestId}`);
    if ((await this.deps.desk.withdraw(keyOf("permission", [agent.id, requestId]))) || !told) return;
    const owner = await ownerOf(this.deps.desk, projectOf(agent.cwd), agent.id, role);
    const who = this.nameOf(projectOf(agent.cwd), agent, role);
    await this.deps.desk.post(
      owner.to,
      seatLetters.permissionAnswered(agent.id, who, requestId, resolution.behavior === "allow"),
    );
  }

  /** The Human wrote to a Lead or Peer in its own chat: whoever supervises is told, so nothing reaches a lane past its owner unseen. */
  async spoke(seat: { id: string; provider: string; cwd: string }, text: string): Promise<void> {
    const role = seatOf(this.deps.kit, seat.provider)?.role;
    if (!role || can(role, "supervise")) return;
    const project = projectOf(seat.cwd);
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, seat.id);
    const lane = task ? ledger.lanes[task.lane] : leadLaneOf(ledger, seat.id);
    if (!lane) return;
    const to = await this.deps.desk.supervisorFor(project, lane.opener);
    await this.deps.desk.post(to, messageLetters.humanWrote(lane, task, seat.id, text));
  }

  async ended(event: TurnEnded): Promise<void> {
    const { agent, outcome, timeline } = event;
    const seat = seatOf(this.deps.kit, agent.provider);
    const role = seat?.role;
    if (!seat || !role?.tools) return;
    const project = projectOf(agent.cwd);
    this.deps.remember(project);
    const started = this.startedAt.get(agent.id) ?? Date.now() - 30 * 60_000;
    this.startedAt.delete(agent.id);
    if (outcome.kind === "canceled") return;
    const text = outputText(timeline);
    this.lastEnding.set(agent.id, text);
    const limit = limitStop(seat.harness, outcome.kind === "failed" ? outcome.error.message : lastWords(timeline));
    if (limit) return this.limited(project, agent, seat, limit.resets);
    clearLimited(this.deps.desk, project, agent.id);
    // Only a failed turn is read for provider trouble: a Peer's own words may name a 401 its work met.
    const turn = { agent: agent.id, id: event.turnId ?? Date.now() };
    const said = outcome.kind === "failed" ? outcome.error.message : "";
    const trouble = await this.trouble.ended(project, { ...turn, said }, seat.harness);
    if (trouble === "retried") return;
    if (outcome.kind === "failed") {
      const owner = await ownerOf(this.deps.desk, project, agent.id, role);
      const who = this.nameOf(project, agent, role);
      const letter = seatLetters.failed(agent.id, turn.id, who, said, owner.reader, trouble === "signedOut");
      await this.deps.desk.post(owner.to, letter);
      return;
    }
    const ledger = loadLedger(project.state);
    const recorded = (ledger.agents[agent.id]?.recordedAt ?? 0) >= started;
    if (worksTasks(role)) await this.workerEnded(project, ledger, event, text, recorded);
  }

  private async workerEnded(
    project: Project,
    ledger: Ledger,
    event: TurnEnded,
    text: string,
    recorded: boolean,
  ): Promise<void> {
    const task = taskOfPeer(ledger, event.agent.id);
    if (!task) return;
    if (DECIDED.includes(task.status) && !recorded) return;
    // Handed back, or its merge failed: what comes next is its Lead's call, so a quiet turn is no silence.
    if (recorded || task.status === "done" || task.status === "failed") return this.heard(project, task, recorded);
    // A call still in flight is not silence: a nudge here started a second gate beside the first.
    if (this.deps.desk.inFlight(event.agent.id)) return;
    // Told to end its turn once it asked: it is waiting, and the ask round keeps the wait in its reader's sight.
    if (openAskOf(ledger, event.agent.id, task.id)) return;
    // Held by its Lead until another task lands: the desk wakes it then.
    if (task.held) return;
    await this.silent(project, ledger.lanes[task.lane], task, event, text);
  }

  private nameOf(project: Project, agent: HookAgent, role: RoleSpec): string {
    return seatName(loadLedger(project.state), agent, role);
  }

  /** Only a hand-back restarts the quiet count, or a stall its Lead was told of: an ask after each nudge once looped seven times. */
  private heard(project: Project, task: Task, recorded: boolean): void {
    if (!recorded || (task.status !== "stalled" && task.silent < QUIET)) return;
    const reset = (entry: Task) => {
      delete entry.peerGone;
      entry.silent = 0;
    };
    if (task.status === "stalled") this.deps.desk.moveTask(project, task.id, "resume", reset);
    else this.deps.desk.setTask(project, task.id, reset);
  }

  /** An agent stopped on its usage limit has not gone quiet: its owner is told once a spell, and the patrol wakes it at the reset. */
  private async limited(
    project: Project,
    agent: HookAgent,
    seat: { role: RoleSpec; harness: HarnessSpec },
    resets: string | null,
  ): Promise<void> {
    const { desk } = this.deps;
    const now = Date.now();
    const wakeAt = wakeTime(resets, now);
    desk.event(project, { kind: "seat.limited", agent: agent.id, resets, wakeAt: wakeAt ?? null });
    const since = markLimited(desk, project, { id: agent.id, role: seat.role.role }, wakeAt, now);
    if (since === undefined) return;
    if (can(seat.role, "supervise")) {
      await desk.pageLimited(project, resets, waitingOn(loadLedger(project.state), agent.id));
      return;
    }
    const owner = await ownerOf(this.deps.desk, project, agent.id, seat.role);
    const meanwhile = meanwhileRoles(this.deps.source.teamFor(project), seat.role, seat.harness.id);
    const waiting = can(seat.role, "lead") ? waitingOn(loadLedger(project.state), agent.id) : [];
    const who = this.nameOf(project, agent, seat.role);
    const take = { meanwhile, waiting };
    await desk.post(owner.to, seatLetters.limited(agent.id, who, since, { resets, wakeAt }, take, owner.reader));
  }

  /** A turn ended with no hand-back and no ask: counted and nudged, then stalled and told to its Lead, whose call the fix is. */
  private async silent(
    project: Project,
    lane: Lane | undefined,
    task: Task,
    event: TurnEnded,
    text: string,
  ): Promise<void> {
    const { desk } = this.deps;
    const { agent, timeline } = event;
    const denied = deniedCall(timeline, this.deps.kit.ecosystem.watch.refused);
    const jobs = pendingJobs(timeline, seatOf(this.deps.kit, agent.provider)?.harness.timeline?.background);
    desk.event(project, {
      kind: "turn.silent",
      task: task.id,
      denied: denied?.what ?? null,
      refused: denied?.refused ?? false,
      lastCall: JSON.stringify(lastToolCall(timeline) ?? null).slice(0, 600),
      wouldWait: jobs.length ? `background job ${jobs.join(", ")}` : null,
    });
    const updated = desk.setTask(project, task.id, (entry) => {
      entry.silent += 1;
      if (entry.silent >= QUIET || denied) TASK.move(entry, "stall");
    });
    if (!updated) return;
    if (updated.status !== "stalled") {
      await desk.post(agent.id, seatLetters.nudge(updated, "done"));
      return;
    }
    const reader = await desk.readerOf(project, lane);
    await desk.post(reader.to, seatLetters.stalled(task, text, updated.silent, denied, reader.as));
    desk.event(project, {
      kind: "task.silent",
      task: task.id,
      denied: denied?.what ?? null,
      refused: denied?.refused ?? false,
    });
  }
}
