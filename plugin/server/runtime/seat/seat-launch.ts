import { renderPrompt } from "../../catalog/kit/content.ts";
import { type Kit, type RoleSpec, SEAT_KEY } from "../../catalog/kit/kit.ts";
import { seatOf } from "../../catalog/kit/roles.ts";
import { applyRole, seatBin, seatEnv } from "../../catalog/seat/launch.ts";
import { seedRecords } from "../../catalog/seat/seat-files.ts";
import { seatDir } from "../../catalog/seat/seats.ts";
import { daemonLog } from "../../core/logger.ts";
import { guidesDir, home } from "../../core/paths.ts";
import type { AgentConfig, SessionOpen } from "../../core/ports.ts";
import { type Project, projectOf } from "../../desk/project/project.ts";
import type { SeatKeys } from "./keys.ts";
import type { Seating } from "./seating.ts";

/** What Paseo's create and session-open hooks give a seat: its built directory, its launch config and env, and its key. */
export class SeatLaunch {
  private readonly kit: Kit;
  private readonly seating: Seating;
  private readonly keys: SeatKeys;
  private readonly remember: (project: Project) => void;

  constructor(kit: Kit, seating: Seating, keys: SeatKeys, remember: (project: Project) => void) {
    this.kit = kit;
    this.seating = seating;
    this.keys = keys;
    this.remember = remember;
  }

  /** A seat with tools is given a key, which its team server shows the desk to say which seat calls. */
  create(config: AgentConfig, env: Record<string, string> = {}): { config: AgentConfig; env: Record<string, string> } {
    const seat = seatOf(this.kit, config.provider);
    if (!seat) return { config, env };
    const project = projectOf(config.cwd);
    this.remember(project);
    const team = this.seating.ensure(seat.role.role, seat.harness, project);
    const paths = { guides: guidesDir(), state: project.state };
    const render = (role: RoleSpec) => renderPrompt(this.kit, role, seat.harness.id, paths);
    const key = seat.role.tools ? this.keys.issue() : undefined;
    const servers = this.seating.servers(team, seat.role.role, key);
    const applied = applyRole(this.kit, team, config, render, project.state, servers);
    return { config: applied, env: key ? { ...env, [SEAT_KEY]: key } : env };
  }

  sessionOpen(request: SessionOpen): SessionOpen {
    const seat = seatOf(this.kit, request.provider);
    if (!seat) return request;
    const project = projectOf(request.cwd);
    this.remember(project);
    try {
      seedRecords(this.kit, project.state);
    } catch (error) {
      daemonLog.error("could not seed project records:", error);
    }
    this.seating.ensure(seat.role.role, seat.harness, project);
    const dir = seatDir(this.kit, seat.role, seat.harness, home(), project);
    const opened = seatEnv(this.kit, request, dir, project, seatBin(this.kit));
    // Created, the seat brings the key made for it; opened again, it is given back the one it was bound to.
    const key = request.reason === "create" ? request.env[SEAT_KEY] : this.keys.keyOf(request.agentId);
    if (request.reason === "create" && key) this.keys.bind(request.agentId, key);
    return key ? { ...opened, env: { ...opened.env, [SEAT_KEY]: key } } : opened;
  }
}
