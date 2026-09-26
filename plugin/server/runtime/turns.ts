import type { Kit, RoleSpec } from "../catalog/kit/kit.ts";
import { can, seatOf, toolsOf, worksTasks } from "../catalog/kit/roles.ts";
import type { PermissionRequested, Seats, TurnEnded } from "../core/ports.ts";
import { DECIDED, TASK } from "../domain/task.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ledger, laneOfLead, leadLaneOf, taskOfPeer } from "../domain/ledger.ts";
import { laneOnHold, loadLedger } from "../desk/store/ledger.ts";
import { letters } from "../desk/letters/letters.ts";
import { type Project, projectOf } from "../desk/project.ts";
import { deniedCall, lastToolCall, outputText } from "./timeline.ts";

type TurnDeps = {
  kit: Kit;
  desk: Desk;
  seats: Pick<Seats, "respond">;
  remember: (project: Project) => void;
  log: (project: Project, line: string) => void;
};

/** Where a seat puts a question instead, by the tools it holds: one that holds no way to ask settles it itself. */
function askInstead(tools: string[]): string {
  if (tools.includes("ask_human")) return "put it to the Human with ask_human, or ask them in your reply and end your turn";
  if (tools.includes("ask")) return "ask it with ask, then end your turn; the answer arrives as a message";
  return "answer from what you have, saying what you could not settle, then end your turn";
}

export class TurnRules {
  readonly lastEnding = new Map<string, string>();
  private readonly deps: TurnDeps;
  private readonly startedAt = new Map<string, number>();

  constructor(deps: TurnDeps) {
    this.deps = deps;
  }

  started(agentId: string): void {
    this.startedAt.set(agentId, Date.now());
  }

  forget(agentId: string): void {
    this.startedAt.delete(agentId);
    this.lastEnding.delete(agentId);
  }

  private async ownerOf(project: Project, agentId: string, role: RoleSpec): Promise<{ to: string | undefined; reader: "lead" | "supervisor" | "leadGone" }> {
    // A Lead's owner is whoever supervises; an unreadable ledger must not stop its failures reaching anyone.
    if (can(role, "lead")) {
      let opener: string | undefined;
      try {
        opener = laneOfLead(loadLedger(project.state), agentId)?.opener;
      } catch {}
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
      await this.deps.seats.respond(agent.id, request.id, { behavior: "deny", message: `Lane ${hold.id} is on hold: ${hold.onHold!.reason}. Do nothing more until you are told it resumes.` });
      return;
    }
    // A seat stopped on a question reads nothing, and a team waiting on a sleeping Human is stuck: the question goes by the desk.
    if (request.kind === "question" && request.id) {
      await this.deps.seats.respond(agent.id, request.id, { behavior: "deny", message: `A question that stops your turn is not taken here: ${askInstead(toolsOf(this.deps.kit, role))}.` });
      return;
    }
    if (can(role, "supervise")) {
      this.deps.log(project, `waiting on the Human: ${agent.id} ${request.title ?? request.name ?? request.kind}`);
      return;
    }
    const owner = await this.ownerOf(project, agent.id, role);
    await this.deps.desk.post(owner.to, letters.permission(agent.id, agent.title ?? `${role.label} ${agent.id}`, request, owner.reader));
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
    await this.deps.desk.post(to, letters.humanWrote(lane, task, seat.id, text));
  }

  async ended(event: TurnEnded): Promise<void> {
    const { agent, outcome, timeline } = event;
    const role = seatOf(this.deps.kit, agent.provider)?.role;
    if (!role?.tools) return;
    const project = projectOf(agent.cwd);
    this.deps.remember(project);
    const started = this.startedAt.get(agent.id) ?? Date.now() - 30 * 60_000;
    this.startedAt.delete(agent.id);
    if (outcome.kind === "canceled") return;
    const text = outputText(timeline);
    this.lastEnding.set(agent.id, text);
    if (outcome.kind === "failed") {
      const owner = await this.ownerOf(project, agent.id, role);
      await this.deps.desk.post(owner.to, letters.failed(agent.id, event.turnId ?? Date.now(), agent.title ?? `${role.label} ${agent.id}`, outcome.error.message, owner.reader));
      return;
    }
    const ledger = loadLedger(project.state);
    const recorded = (ledger.agents[agent.id]?.recordedAt ?? 0) >= started;
    // The read-only status tool counts as heard from, but not as reaching somebody.
    const spoke = (ledger.agents[agent.id]?.spokeAt ?? 0) >= started;
    if (worksTasks(role)) await this.workerEnded(project, ledger, event, text, recorded, spoke);
  }

  private async workerEnded(project: Project, ledger: Ledger, event: TurnEnded, text: string, recorded: boolean, spoke: boolean): Promise<void> {
    const { desk } = this.deps;
    const { agent, timeline } = event;
    const task = taskOfPeer(ledger, agent.id);
    if (!task) return;
    if (DECIDED.includes(task.status) && !recorded) return;
    const lane = ledger.lanes[task.lane];
    if (recorded || task.status === "done") {
      // Heard from, so the quiet count restarts; left standing it was a lifetime tally.
      if (spoke && task.silent > 0) desk.setTask(project, task.id, (entry) => { entry.silent = 0; });
      // Nothing else sets a stalled task back to running once its Peer works again.
      if (recorded && task.status === "stalled") desk.moveTask(project, task.id, "resume", (entry) => { delete entry.peerGone; });
      return;
    }
    // A call still in flight is not silence: a nudge here started a second gate beside the first.
    if (desk.inFlight(agent.id)) return;
    const denied = deniedCall(timeline, this.deps.kit.ecosystem.watch.refused);
    desk.event(project, { kind: "turn.silent", task: task.id, denied: denied?.what ?? null, refused: denied?.refused ?? false, lastCall: JSON.stringify(lastToolCall(timeline) ?? null).slice(0, 600) });
    const updated = desk.setTask(project, task.id, (entry) => {
      entry.silent += 1;
      if (entry.silent >= 2 || denied) TASK.move(entry, "stall");
    });
    if (!updated) return;
    if (updated.status !== "stalled") {
      await desk.post(agent.id, letters.nudge(updated, "done"));
      return;
    }
    await desk.post(lane?.lead, letters.stalled(task, text, updated.silent, denied));
    desk.event(project, { kind: "task.silent", task: task.id, denied: denied?.what ?? null, refused: denied?.refused ?? false });
    if (task.status === "stalled") return;
    const why = denied ? `its Peer's last call ${denied.refused ? "was refused" : "did not finish"}: ${denied.what}` : `its Peer ended ${updated.silent} turns without a hand-back or an ask`;
    await desk.post(await desk.supervisorFor(project, lane?.opener), letters.moment("STRUGGLING", updated, why));
  }
}
