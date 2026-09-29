import type { HarnessSpec, Kit, RoleSpec } from "../catalog/kit/kit.ts";
import { can, seatOf, toolsOf, worksTasks } from "../catalog/kit/roles.ts";
import type { HookAgent, PermissionRequested, Seats, TurnEnded } from "../core/ports.ts";
import type { Lane } from "../domain/lane.ts";
import { DECIDED, TASK, type Task } from "../domain/task.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ledger, laneOfLead, leadLaneOf, openAskOf, taskOfPeer } from "../domain/ledger.ts";
import { laneOnHold, loadLedger } from "../desk/store/ledger.ts";
import { seatLetters } from "../desk/letters/seat-letters.ts";
import { messageLetters } from "../desk/letters/message-letters.ts";
import { watchLetters } from "../desk/letters/watch-letters.ts";
import { type Project, projectOf } from "../desk/project/project.ts";
import type { TeamSource } from "./team-source.ts";
import { clearLimited, markLimited, meanwhileRoles, wakeTime } from "./limits.ts";
import { deniedCall, lastToolCall, lastWords, limitStop, outputText } from "./timeline.ts";

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

  constructor(deps: TurnDeps) {
    this.deps = deps;
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
  }

  private async ownerOf(
    project: Project,
    agentId: string,
    role: RoleSpec,
  ): Promise<{ to: string | undefined; reader: "lead" | "supervisor" | "leadGone" }> {
    // A Lead's owner is whoever supervises; an unreadable ledger must not stop its failures reaching anyone.
    if (can(role, "lead")) {
      let opener: string | undefined;
      try {
        opener = laneOfLead(loadLedger(project.state), agentId)?.opener;
      } catch {
        // No opener then: whoever supervises the project is asked.
      }
      return { to: await this.deps.desk.supervisorFor(project, opener), reader: "supervisor" };
    }
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, agentId);
    if (!task) return { to: undefined, reader: "lead" };
    // A Lead no longer seated would never read it: whoever supervises is told, and can seat one.
    const reader = await this.deps.desk.readerOf(project, ledger.lanes[task.lane]);
    return { to: reader.to, reader: reader.as === "lead" ? "lead" : "leadGone" };
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
    const owner = await this.ownerOf(project, agent.id, role);
    await this.deps.desk.post(
      owner.to,
      seatLetters.permission(agent.id, agent.title ?? `${role.label} ${agent.id}`, request, owner.reader),
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
    if (outcome.kind === "failed") {
      const owner = await this.ownerOf(project, agent.id, role);
      await this.deps.desk.post(
        owner.to,
        seatLetters.failed(
          agent.id,
          event.turnId ?? Date.now(),
          agent.title ?? `${role.label} ${agent.id}`,
          outcome.error.message,
          owner.reader,
        ),
      );
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
    await this.silent(project, ledger.lanes[task.lane], task, event, text);
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
    if (since === undefined || can(seat.role, "supervise")) return;
    const owner = await this.ownerOf(project, agent.id, seat.role);
    const meanwhile = meanwhileRoles(this.deps.source.teamFor(project), seat.role, seat.harness.id);
    const who = agent.title ?? `${seat.role.label} ${agent.id}`;
    await desk.post(owner.to, seatLetters.limited(agent.id, who, since, { resets, wakeAt }, meanwhile, owner.reader));
  }

  /** A turn ended with no hand-back and no ask: counted and nudged, then stalled and told to its Lead, and once to whoever supervises. */
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
    desk.event(project, {
      kind: "turn.silent",
      task: task.id,
      denied: denied?.what ?? null,
      refused: denied?.refused ?? false,
      lastCall: JSON.stringify(lastToolCall(timeline) ?? null).slice(0, 600),
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
    await desk.post(lane?.lead, seatLetters.stalled(task, text, updated.silent, denied));
    desk.event(project, {
      kind: "task.silent",
      task: task.id,
      denied: denied?.what ?? null,
      refused: denied?.refused ?? false,
    });
    if (task.status === "stalled" || task.silent >= QUIET) return;
    const why = denied
      ? `its Peer's last call ${denied.refused ? "was refused" : "did not finish"}: ${denied.what}`
      : `its Peer ended ${updated.silent} turns without a hand-back`;
    await desk.post(await desk.supervisorFor(project, lane?.opener), watchLetters.moment("STRUGGLING", updated, why));
  }
}
