import { type TeamRole, providerId, roleWithTeam } from "../catalog/kit.ts";
import type { Workspaces } from "../core/ports.ts";
import type { DeskContext } from "./context.ts";
import type { Slot, Task } from "./ledger.ts";
import type { Project } from "./project.ts";
import type { Roster } from "./roster.ts";
import type { Slots } from "./slots.ts";

export type StartOptions = { parent?: string; title: string; prompt: string; labels: Record<string, string> };

export class Agents {
  private readonly ctx: DeskContext;
  private readonly roster: Roster;
  private readonly slots: Slots;
  private readonly workspaces: Workspaces;

  constructor(ctx: DeskContext, roster: Roster, slots: Slots, workspaces: Workspaces) {
    this.ctx = ctx;
    this.roster = roster;
    this.slots = slots;
    this.workspaces = workspaces;
  }

  private seatConfig(project: Project, team: TeamRole): { role: ReturnType<typeof roleWithTeam>; config: Record<string, unknown> } {
    const role = roleWithTeam(this.ctx.kit, team);
    if (!role) throw new Error(`roles.json has no role for ${team}`);
    const seat = this.ctx.team(project).roles[role.role];
    if (!seat) throw new Error(`the team settings leave the ${role.label} without a harness`);
    const provider = providerId(this.ctx.kit, role.role, seat.harness.id);
    const config: Record<string, unknown> = { provider: seat.model ? `${provider}/${seat.model.id}` : provider };
    if (seat.harness.provider.profileModeId) config.modeId = seat.harness.provider.profileModeId;
    if (seat.thinking) config.thinkingOptionId = seat.thinking;
    return { role, config };
  }

  async startResident(project: Project, team: TeamRole, options: StartOptions): Promise<string> {
    const { role, config } = this.seatConfig(project, team);
    const name = `${project.slug} ${role!.role}`;
    const kept = await this.workspaces.named(name).catch(() => undefined);
    const workspace = kept ?? (await this.workspaces.make(name, project.root));
    const started = await this.workspaces.seat(workspace, {
      config,
      title: options.title,
      prompt: options.prompt,
      labels: { ...options.labels, "seatworks.project": project.slug },
    });
    return started.id;
  }

  async start(project: Project, slot: Pick<Slot, "path" | "workspaceId">, team: TeamRole, options: StartOptions): Promise<string> {
    const role = roleWithTeam(this.ctx.kit, team);
    if (!role) throw new Error(`roles.json has no role for ${team}`);
    if (!slot.workspaceId) throw new Error("the working copy has no workspace");
    const seat = this.ctx.team(project).roles[role.role];
    if (!seat) throw new Error(`the team settings leave the ${role.label} without a harness`);
    const provider = providerId(this.ctx.kit, role.role, seat.harness.id);
    const config: Record<string, unknown> = { provider: seat.model ? `${provider}/${seat.model.id}` : provider };
    if (seat.harness.provider.profileModeId) config.modeId = seat.harness.provider.profileModeId;
    if (seat.thinking) config.thinkingOptionId = seat.thinking;
    const started = await this.workspaces.seat(slot.workspaceId, {
      config,
      parent: options.parent,
      title: options.title,
      prompt: options.prompt,
      labels: { ...options.labels, "seatworks.project": project.slug },
    });
    const actual = started.cwd;
    if (actual && actual !== slot.path) {
      await this.roster.archive(started.id, true);
      throw new Error(`the agent was placed in ${actual} instead of ${slot.path}`);
    }
    return started.id;
  }

  async retire(project: Project, task: Task, dropBranch = false): Promise<void> {
    await this.roster.archive(task.peer);
    if (task.kind === "code" && task.mode === "parallel") await this.slots.release(project, task.slot, dropBranch ? task.branch : undefined);
  }
}
