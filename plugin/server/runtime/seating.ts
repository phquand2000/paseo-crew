import type { HarnessSpec, Kit, McpServers } from "../catalog/kit/kit.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectImports } from "../catalog/seat/launch.ts";
import { materialize, seatDir } from "../catalog/seat/seats.ts";
import { serversFor } from "../catalog/seat/servers.ts";
import { type Team, withHarness } from "../catalog/team/team.ts";
import { expandHome, home } from "../core/paths.ts";
import type { Project } from "../desk/project/project.ts";
import type { TeamSource } from "./team-source.ts";
import { errorText } from "../core/errors.ts";
import { daemonLog } from "../core/logger.ts";

type SeatContext = { node: string; socket: string };

/** Builds a seat's directory for its role, agent and project, once per settings revision while the directory still holds. */
export class Seating {
  private readonly kit: Kit;
  private readonly source: TeamSource;
  private readonly context: SeatContext;
  private readonly built = new Set<string>();

  constructor(kit: Kit, source: TeamSource, context: SeatContext) {
    this.kit = kit;
    this.source = source;
    this.context = context;
  }

  servers(team: Team, roleName: string, key?: string): McpServers {
    return serversFor(this.kit, team, roleName, this.context, key);
  }

  ensure(roleName: string, harness: HarnessSpec, project?: Project): Team {
    const team = withHarness(this.source.teamFor(project), roleName, harness);
    const key = `${roleName}|${harness.id}|${project?.slug ?? ""}|${this.source.revision(project)}|${projectImports(harness, project?.root)}`;
    // Remembering a seat was built is no proof its directory still exists; a seat without instructions runs with none.
    const seat = team.roles[roleName];
    const dir = seat ? seatDir(this.kit, seat.role, harness, home(), project) : undefined;
    // And a login made after the seat was built is a link the seat does not have yet.
    const linked = (link: { link: string; target: string }) =>
      !existsSync(expandHome(link.target)) || existsSync(join(dir!, link.link));
    const built = dir ? existsSync(join(dir, harness.settings.file)) && (harness.links ?? []).every(linked) : false;
    if (this.built.has(key) && built) return team;
    try {
      const changes = materialize(this.kit, team, roleName, home(), project, this.servers(team, roleName));
      if (changes.length > 0)
        daemonLog.info(
          `seat ${roleName} on ${harness.id}${project ? ` for ${project.slug}` : ""} updated: ${changes.join(", ")}`,
        );
      this.built.add(key);
    } catch (error) {
      // Not swallowed: refusing the launch names the reason; letting it through runs a full-access agent with no brief.
      daemonLog.error(`seat ${roleName} on ${harness.id} could not be built:`, error);
      throw new Error(`the ${roleName} seat could not be built, so it was not started: ${errorText(error)}`, {
        cause: error,
      });
    }
    return team;
  }

  forget(): void {
    this.built.clear();
  }
}
