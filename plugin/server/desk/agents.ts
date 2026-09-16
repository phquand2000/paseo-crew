import { type TeamRole, providerId, roleWithTeam } from "../catalog/kit.ts";
import type { PaseoApi } from "../core/paseo.ts";
import type { DeskContext } from "./context.ts";
import type { Slot, Task } from "./ledger.ts";
import type { Project } from "./project.ts";
import type { Slots } from "./slots.ts";

export type StartOptions = { parent?: string; title: string; prompt: string; labels: Record<string, string> };

export class Agents {
  private readonly ctx: DeskContext;
  private readonly slots: Slots;

  constructor(ctx: DeskContext, slots: Slots) {
    this.ctx = ctx;
    this.slots = slots;
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

  async startResident(paseo: PaseoApi, project: Project, team: TeamRole, options: StartOptions): Promise<string> {
    const { role, config } = this.seatConfig(project, team);
    const workspace = await paseo.workspaces.create({ title: `${project.slug} ${role!.role}`, source: { kind: "directory", path: project.root } });
    const handle = await workspace.agents.create({
      config: config as never,
      title: options.title.slice(0, 60),
      prompt: options.prompt,
      labels: { ...options.labels, "seatworks.project": project.slug },
    });
    await handle.refresh();
    return handle.id;
  }

  async start(paseo: PaseoApi, project: Project, slot: Pick<Slot, "path" | "workspaceId">, team: TeamRole, options: StartOptions): Promise<string> {
    const role = roleWithTeam(this.ctx.kit, team);
    if (!role) throw new Error(`roles.json has no role for ${team}`);
    if (!slot.workspaceId) throw new Error("the working copy has no workspace");
    const seat = this.ctx.team(project).roles[role.role];
    if (!seat) throw new Error(`the team settings leave the ${role.label} without a harness`);
    const provider = providerId(this.ctx.kit, role.role, seat.harness.id);
    const config: Record<string, unknown> = { provider: seat.model ? `${provider}/${seat.model.id}` : provider };
    if (seat.harness.provider.profileModeId) config.modeId = seat.harness.provider.profileModeId;
    if (seat.thinking) config.thinkingOptionId = seat.thinking;
    const handle = await paseo.workspaces.ref(slot.workspaceId).agents.create({
      config: config as never,
      parent: options.parent,
      title: options.title.slice(0, 60),
      prompt: options.prompt,
      labels: { ...options.labels, "seatworks.project": project.slug },
    });
    await handle.refresh();
    const actual = handle.cwd ?? handle.current()?.cwd;
    if (actual && actual !== slot.path) {
      await this.ctx.archive(paseo, handle.id, true);
      throw new Error(`the agent was placed in ${actual} instead of ${slot.path}`);
    }
    return handle.id;
  }

  async retire(paseo: PaseoApi, project: Project, task: Task, dropBranch = false): Promise<void> {
    await this.ctx.archive(paseo, task.peer);
    if (task.kind === "code" && task.mode === "parallel") await this.slots.release(project, task.slot, dropBranch ? task.branch : undefined);
  }
}
