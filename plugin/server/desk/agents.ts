import { type RoleSpec, providerId } from "../catalog/kit.ts";
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

  private seatConfig(project: Project, roleName: string): { role: RoleSpec; config: Record<string, unknown> } {
    const role = this.ctx.kit.roles.find((entry) => entry.role === roleName);
    if (!role) throw new Error(`roles.json has no role called ${roleName}`);
    const seat = this.ctx.team(project).roles[role.role];
    if (!seat) throw new Error(`the team settings leave the ${role.label} without a harness`);
    const provider = providerId(this.ctx.kit, role.role, seat.harness.id);
    const config: Record<string, unknown> = { provider: seat.model ? `${provider}/${seat.model.id}` : provider };
    if (seat.harness.provider.profileModeId) config.modeId = seat.harness.provider.profileModeId;
    if (seat.thinking) config.thinkingOptionId = seat.thinking;
    return { role, config };
  }

  /** Paseo can filter agents by label, so what a seat is and what it specialises in are written where that filter can read them. */
  private marks(role: RoleSpec, project: Project): Record<string, string> {
    return { "seatworks.project": project.slug, "seatworks.role": role.role, ...(role.concern ? { "seatworks.concern": role.concern } : {}) };
  }

  async startResident(project: Project, roleName: string, options: StartOptions): Promise<string> {
    const { role, config } = this.seatConfig(project, roleName);
    const workspace = await this.slots.projectWorkspace(project);
    const started = await this.workspaces.seat(workspace, {
      config,
      title: options.title,
      prompt: options.prompt,
      labels: { ...this.marks(role, project), ...options.labels },
    });
    return started.id;
  }

  async start(project: Project, slot: Pick<Slot, "path" | "workspaceId">, roleName: string, options: StartOptions): Promise<string> {
    if (!slot.workspaceId) throw new Error("the working copy has no workspace");
    const { role, config } = this.seatConfig(project, roleName);
    const started = await this.workspaces.seat(slot.workspaceId, {
      config,
      parent: options.parent,
      title: options.title,
      prompt: options.prompt,
      labels: { ...this.marks(role, project), ...options.labels },
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
