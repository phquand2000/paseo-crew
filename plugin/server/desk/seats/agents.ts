import type { RoleSpec } from "../../catalog/kit/kit.ts";
import { providerId } from "../../catalog/kit/roles.ts";
import { contains, dropMerged } from "../../core/git.ts";
import type { Workspaces } from "../../core/ports.ts";
import type { DeskBase } from "../base.ts";
import { letGo } from "./gone.ts";
import { type Slot, type Task, loadLedger } from "../store/ledger.ts";
import type { Project } from "../project.ts";
import type { Roster } from "./roster.ts";
import type { Slots } from "../copies/slots.ts";
import type { Teardowns } from "./teardown.ts";

type StartOptions = { parent?: string; title: string; prompt: string; labels: Record<string, string> };

export class Agents {
  private readonly desk: Pick<DeskBase, "kit" | "teamFor" | "ledgers">;
  private readonly roster: Roster;
  private readonly slots: Slots;
  private readonly teardowns: Teardowns;
  private readonly workspaces: Workspaces;

  constructor(
    desk: Pick<DeskBase, "kit" | "teamFor" | "ledgers">,
    roster: Roster,
    slots: Slots,
    teardowns: Teardowns,
    workspaces: Workspaces,
  ) {
    this.desk = desk;
    this.roster = roster;
    this.slots = slots;
    this.teardowns = teardowns;
    this.workspaces = workspaces;
  }

  private seatConfig(project: Project, roleName: string): { role: RoleSpec; config: Record<string, unknown> } {
    const role = this.desk.kit.roles.find((entry) => entry.role === roleName);
    if (!role) throw new Error(`roles.json has no role called ${roleName}`);
    const seat = this.desk.teamFor(project).roles[role.role];
    if (!seat) throw new Error(`the team settings leave the ${role.label} without a harness`);
    const provider = providerId(this.desk.kit, role.role, seat.harness.id);
    const config: Record<string, unknown> = { provider: seat.model ? `${provider}/${seat.model.id}` : provider };
    if (seat.harness.provider.profileModeId) config.modeId = seat.harness.provider.profileModeId;
    if (seat.thinking) config.thinkingOptionId = seat.thinking;
    return { role, config };
  }

  /** Paseo can filter agents by label, so what a seat is and what it specialises in are written where that filter can read them. */
  private marks(role: RoleSpec, project: Project): Record<string, string> {
    return {
      "seatworks.project": project.slug,
      "seatworks.role": role.role,
      ...(role.concern ? { "seatworks.concern": role.concern } : {}),
    };
  }

  /** A seat that belongs to the project rather than to a lane: it sits in the project's own workspace. */
  async startResident(project: Project, roleName: string, options: StartOptions): Promise<string> {
    const { role, config } = this.seatConfig(project, roleName);
    const workspace = await this.slots.projectWorkspace(project);
    const started = await this.workspaces.seat(workspace.id, {
      config,
      parent: options.parent,
      title: options.title,
      prompt: options.prompt,
      labels: { ...this.marks(role, project), ...options.labels },
    });
    return started.id;
  }

  async start(
    project: Project,
    slot: Pick<Slot, "path" | "workspaceId">,
    roleName: string,
    options: StartOptions,
  ): Promise<string> {
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

  /** `into` is the branch the task's work was to land in: its own branch goes only once it is in there. */
  async retire(project: Project, task: Task, into?: string): Promise<string | undefined> {
    await letGo(this.desk, this.roster, project, task.peer);
    if (task.kind !== "code") return undefined;
    // A task in the lane's copy leaves only its branch: dropped once `into` holds all of it, kept and named while it holds more.
    if (task.mode !== "parallel")
      return task.branch &&
        into &&
        !(await dropMerged(project.root, task.branch, into)) &&
        (await contains(project.root, into, task.branch)) === false
        ? task.branch
        : undefined;
    // Everyone sharing the copy, not only this Peer: a reviewer reads from it too, and removing it loses the verdict.
    const sharing = task.slot
      ? Object.values(loadLedger(project.state).tasks).filter(
          (other) => other.id !== task.id && other.slot === task.slot && other.status === "running",
        )
      : [];
    for (const other of sharing) await letGo(this.desk, this.roster, project, other.peer);
    const writing = [task.peer, ...sharing.map((other) => other.peer)].filter(
      (id): id is string => typeof id === "string" && this.roster.archiving(id),
    );
    return this.teardowns.putAway({ project, slot: task.slot, dropBranch: task.branch, into }, writing);
  }
}
