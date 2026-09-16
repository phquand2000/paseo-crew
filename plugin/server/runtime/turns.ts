import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { type Kit, type RoleSpec, seatOf } from "../catalog/kit.ts";
import type { PaseoApi } from "../core/paseo.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ledger, activeTasks, laneOfLead, loadLedger, openAsksFrom, taskOfPeer } from "../desk/ledger.ts";
import { letters } from "../desk/letters.ts";
import { type Project, projectOf } from "../desk/project.ts";
import { deniedCall, lastToolCall, outputText } from "./timeline.ts";

export const CUES =
  /\b(but|hold on|wait(ing)? (for|on)|actually|turns out|not sure|workaround|for now|instead|revert(ed)?|rm -rf|reset --hard|force[- ]push|drop (table|database)|skip(ped|ping)?|flaky|once .{1,40} lands?|let me know|should i|is (this|that) (ok|allowed)|shim|adapter|compat(ibility)?|bridge|backward|legacy|temporar(y|ily)|stub|placeholder|re-?export)\b|chờ|đợi|tạm dừng|dừng lại|không chắc|hóa ra|hoá ra|sai rồi|bỏ qua|tạm thời|tương thích|xóa|xoá/i;

type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];

export type Watch = { project: Project; lane: string; agent: string; role: string; where: string; text: string };

export type TurnDeps = {
  kit: Kit;
  desk: Desk;
  remember: (project: Project) => void;
  watch: (item: Watch) => void;
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

  async ownerOf(paseo: PaseoApi, project: Project, agentId: string, role: RoleSpec): Promise<string | undefined> {
    const ledger = loadLedger(project.state);
    if (role.team === "lead") return this.deps.desk.supervisorFor(paseo, project, laneOfLead(ledger, agentId)?.opener);
    const task = taskOfPeer(ledger, agentId);
    return task ? ledger.lanes[task.lane]?.lead : undefined;
  }

  async ended(paseo: PaseoApi, event: TurnEnded): Promise<void> {
    const { agent, outcome, timeline } = event;
    const role = seatOf(this.deps.kit, agent.provider)?.role;
    if (!role?.team) return;
    const project = projectOf(agent.cwd);
    this.deps.remember(project);
    const started = this.startedAt.get(agent.id) ?? Date.now() - 30 * 60_000;
    this.startedAt.delete(agent.id);
    if (outcome.kind === "canceled") return;
    const text = outputText(timeline);
    this.lastEnding.set(agent.id, text);
    if (outcome.kind === "failed") {
      const owner = await this.ownerOf(paseo, project, agent.id, role);
      await this.deps.desk.post(paseo, owner, `failed:${agent.id}:${event.turnId ?? Date.now()}`, letters.failed(`${role.label} ${agent.title ?? agent.id}`, outcome.error.message));
      return;
    }
    const ledger = loadLedger(project.state);
    const recorded = (ledger.agents[agent.id]?.recordedAt ?? 0) >= started;
    if (role.team === "peer" || role.team === "reviewer") await this.workerEnded(paseo, project, ledger, event, role.team, text, recorded);
    else if (role.team === "lead") this.leadEnded(project, ledger, agent.id, text, recorded);
  }

  private async workerEnded(paseo: PaseoApi, project: Project, ledger: Ledger, event: TurnEnded, team: "peer" | "reviewer", text: string, recorded: boolean): Promise<void> {
    const { desk } = this.deps;
    const { agent, timeline } = event;
    const task = taskOfPeer(ledger, agent.id);
    if (!task || ["merged", "cut", "queued", "merging"].includes(task.status)) return;
    const lane = ledger.lanes[task.lane];
    if (recorded || task.status === "done") {
      const claimedComplete = task.status === "done" && task.handback?.outcome === "complete";
      if (lane && (CUES.test(text) || claimedComplete)) {
        this.deps.watch({ project, lane: lane.id, agent: agent.id, role: team, where: `the Peer on ${task.id} (${task.title})`, text });
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
      await desk.post(paseo, agent.id, `nudge:${task.id}:${updated.silent}:${Date.now()}`, letters.nudge("done"));
      return;
    }
    await desk.post(paseo, lane?.lead, `silent:${task.id}:${updated.silent}`, letters.stalled(task, text, denied));
    desk.event(project, { kind: "task.silent", task: task.id, denied: denied ?? null });
  }

  private leadEnded(project: Project, ledger: Ledger, agentId: string, text: string, recorded: boolean): void {
    const lane = laneOfLead(ledger, agentId);
    if (!lane) return;
    const busy = activeTasks(ledger, lane.id).length > 0 || openAsksFrom(ledger, agentId).length > 0;
    if (CUES.test(text) || (!recorded && !busy)) {
      this.deps.watch({ project, lane: lane.id, agent: agentId, role: "lead", where: `the Lead of ${lane.id} (${lane.title})`, text });
    }
  }
}
