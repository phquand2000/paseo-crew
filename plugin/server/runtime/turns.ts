import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { type Attention, type Kit, type RoleSpec, can, seatOf } from "../catalog/kit.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ledger, laneOfLead, loadLedger, taskOfPeer } from "../desk/ledger.ts";
import { letters } from "../desk/letters.ts";
import { type Project, loadConfig, projectOf } from "../desk/project.ts";
import { type Reading, read } from "./risks.ts";
import { deniedCall, lastToolCall, outputText } from "./timeline.ts";

type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];

export type Watch = { project: Project; lane: string; agent: string; role: string; where: string; text: string; reading: Reading };

export type TurnDeps = {
  kit: Kit;
  desk: Desk;
  remember: (project: Project) => void;
  watch: (item: Watch) => void;
  attention?: (project: Project) => Attention;
};

export class TurnRules {
  readonly lastEnding = new Map<string, string>();
  private readonly deps: TurnDeps;
  private readonly startedAt = new Map<string, number>();
  private readonly clean = new Map<string, number>();

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
    const ledger = loadLedger(project.state);
    if (can(role, "lead")) return this.deps.desk.supervisorFor(project, laneOfLead(ledger, agentId)?.opener);
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
    const reading = read(timeline, { gate: loadConfig(project.state).gate, recorded });
    if (can(role, "work")) await this.workerEnded(project, ledger, event, role.role, text, recorded, reading);
    else if (can(role, "lead")) this.leadEnded(project, ledger, agent.id, text, reading);
  }

  private watchable(project: Project, reading: Reading, claimed = false): boolean {
    if (claimed || reading.score > 0) return true;
    const every = Math.max(1, this.deps.attention?.(project).watchEveryClean ?? this.deps.kit.attention.watchEveryClean);
    const next = (this.clean.get(project.slug) ?? 0) + 1;
    this.clean.set(project.slug, next % every);
    return next % every === 0;
  }

  private async workerEnded(
    project: Project,
    ledger: Ledger,
    event: TurnEnded,
    roleName: string,
    text: string,
    recorded: boolean,
    reading: Reading,
  ): Promise<void> {
    const { desk } = this.deps;
    const { agent, timeline } = event;
    const task = taskOfPeer(ledger, agent.id);
    if (!task) return;
    const settled = ["merged", "cut", "queued", "merging"].includes(task.status);
    if (settled && !recorded) return;
    const lane = ledger.lanes[task.lane];
    if (recorded || task.status === "done") {
      if (lane && this.watchable(project, reading, recorded)) {
        this.deps.watch({ project, lane: lane.id, agent: agent.id, role: roleName, where: `the Peer on ${task.id} (${task.title})`, text, reading });
      }
      return;
    }
    const denied = deniedCall(timeline, seatOf(this.deps.kit, agent.provider)?.harness.refused);
    desk.event(project, { kind: "turn.silent", task: task.id, denied: denied ?? null, lastCall: JSON.stringify(lastToolCall(timeline) ?? null).slice(0, 600) });
    const updated = await desk.setTask(project, task.id, (entry) => {
      entry.silent += 1;
      if (entry.silent >= 2 || denied) entry.status = "stalled";
    });
    if (!updated) return;
    if (updated.status !== "stalled") {
      await desk.post(agent.id, `nudge:${task.id}:${updated.silent}:${Date.now()}`, letters.nudge("done"));
      return;
    }
    await desk.post(lane?.lead, `silent:${task.id}:${updated.silent}`, letters.stalled(task, text, denied));
    desk.event(project, { kind: "task.silent", task: task.id, denied: denied ?? null });
  }

  private leadEnded(project: Project, ledger: Ledger, agentId: string, text: string, reading: Reading): void {
    const lane = laneOfLead(ledger, agentId);
    if (!lane) return;
    if (!this.watchable(project, reading)) return;
    this.deps.watch({ project, lane: lane.id, agent: agentId, role: "lead", where: `the Lead of ${lane.id} (${lane.title})`, text, reading });
  }
}
