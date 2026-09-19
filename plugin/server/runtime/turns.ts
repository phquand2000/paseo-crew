import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { type Kit, type RoleSpec, can, seatOf, worksTasks } from "../catalog/kit.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ledger, laneOfLead, loadLedger, taskOfPeer } from "../desk/ledger.ts";
import { letters } from "../desk/letters.ts";
import { type Project, projectOf } from "../desk/project.ts";
import { deniedCall, lastToolCall, outputText } from "./timeline.ts";

type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];

export type TurnDeps = {
  kit: Kit;
  desk: Desk;
  remember: (project: Project) => void;
};

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

  async ownerOf(project: Project, agentId: string, role: RoleSpec): Promise<string | undefined> {
    // A Lead's owner is whoever supervises, which the ledger only narrows. Read first and thrown on,
    // an unreadable ledger stopped a Lead's failed turn and its permission requests reaching anyone.
    if (can(role, "lead")) {
      let opener: string | undefined;
      try {
        opener = laneOfLead(loadLedger(project.state), agentId)?.opener;
      } catch {}
      return this.deps.desk.supervisorFor(project, opener);
    }
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, agentId);
    return task ? ledger.lanes[task.lane]?.lead : undefined;
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
      await this.deps.desk.post(owner, `failed:${agent.id}:${event.turnId ?? Date.now()}`, letters.failed(`${role.label} ${agent.title ?? agent.id}`, outcome.error.message));
      return;
    }
    const ledger = loadLedger(project.state);
    const recorded = (ledger.agents[agent.id]?.recordedAt ?? 0) >= started;
    // Heard from at all, and heard from in a way that reaches somebody, are different questions: the
    // read-only status tool is the first but not the second, and only the second is not being silent.
    const spoke = (ledger.agents[agent.id]?.spokeAt ?? 0) >= started;
    if (worksTasks(role)) await this.workerEnded(project, ledger, event, text, recorded, spoke);
  }

  private async workerEnded(project: Project, ledger: Ledger, event: TurnEnded, text: string, recorded: boolean, spoke: boolean): Promise<void> {
    const { desk } = this.deps;
    const { agent, timeline } = event;
    const task = taskOfPeer(ledger, agent.id);
    if (!task) return;
    const settled = ["merged", "cut", "queued", "merging"].includes(task.status);
    if (settled && !recorded) return;
    const lane = ledger.lanes[task.lane];
    if (recorded || task.status === "done") {
      // Heard from, so the count of quiet turns starts again. Left standing, it was a lifetime tally:
      // a task that went quiet once, asked its question, and went quiet again was marked stalled on
      // its second-ever quiet turn, under a letter saying its turn had ended twice without an ask.
      if (spoke && task.silent > 0) await desk.setTask(project, task.id, (entry) => { entry.silent = 0; });
      // And a stalled task whose Peer is working again is running. Nothing else ever set it back —
      // not the Lead's message the SILENT letter tells it to send, not the Peer's own ask — so the
      // idle-lane check and the gone-Peer check stopped seeing a Peer that was plainly there.
      if (recorded && task.status === "stalled") await desk.setTask(project, task.id, (entry) => { if (entry.status === "stalled") { entry.status = "running"; delete entry.peerGone; } });
      return;
    }
    // A call still being worked on is not silence: a hand-back whose gate runs past what a call can
    // wait was answered "the answer comes by mail", the Peer ended its turn as told, and was then
    // nudged to call done again — which started a second gate beside the first.
    if (desk.inFlight(agent.id)) return;
    const denied = deniedCall(timeline, seatOf(this.deps.kit, agent.provider)?.harness.refused);
    desk.event(project, { kind: "turn.silent", task: task.id, denied: denied?.what ?? null, refused: denied?.refused ?? false, lastCall: JSON.stringify(lastToolCall(timeline) ?? null).slice(0, 600) });
    const updated = await desk.setTask(project, task.id, (entry) => {
      entry.silent += 1;
      if (entry.silent >= 2 || denied) entry.status = "stalled";
    });
    if (!updated) return;
    if (updated.status !== "stalled") {
      await desk.post(agent.id, `nudge:${task.id}:${updated.silent}:${Date.now()}`, letters.nudge("done"));
      return;
    }
    await desk.post(lane?.lead, `silent:${task.id}:${updated.silent}`, letters.stalled(task, text, updated.silent, denied));
    desk.event(project, { kind: "task.silent", task: task.id, denied: denied?.what ?? null, refused: denied?.refused ?? false });
  }
}
