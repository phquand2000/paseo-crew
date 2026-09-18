import type { HarnessSpec, Kit, McpServers } from "../catalog/kit.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { materialize, seatDir } from "../catalog/seats.ts";
import { type Team, serversFor, withHarness } from "../catalog/team.ts";
import { home } from "../core/paths.ts";
import type { Project } from "../desk/project.ts";
import type { TeamSource } from "./team-source.ts";

export type SeatContext = { node: string; spool: string };

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

  servers(team: Team, roleName: string): McpServers {
    return serversFor(this.kit, team, roleName, this.context);
  }

  ensure(roleName: string, harness: HarnessSpec, project?: Project): Team {
    const team = withHarness(this.source.teamFor(project), roleName, harness);
    const key = `${roleName}|${harness.id}|${project?.slug ?? ""}|${this.source.revision(project)}`;
    // Remembering that a seat was built is not evidence that it still is. The directory lives in the
    // owner's home and nothing here owns it: cleaned up, restored from a backup, or removed with the
    // harness, the seat was launched anyway — and the whole reason the failure below is not swallowed
    // is that a seat whose instructions were not written runs with none.
    const seat = team.roles[roleName];
    const built = seat ? existsSync(join(seatDir(this.kit, seat.role, harness, home(), project), harness.settings.file)) : false;
    if (this.built.has(key) && built) return team;
    try {
      const changes = materialize(this.kit, team, roleName, home(), project, this.servers(team, roleName));
      if (changes.length > 0) console.log(`seatworks-v2: seat ${roleName} on ${harness.id}${project ? ` for ${project.slug}` : ""} updated: ${changes.join(", ")}`);
      this.built.add(key);
    } catch (error) {
      // Not swallowed: a seat whose instructions could not be written is a seat that would run with
      // none, and the three before-hooks are the only places a plugin can refuse anything. Refusing
      // the launch names the reason; letting it through hands a full-access agent no brief at all.
      console.error(`seatworks-v2: seat ${roleName} on ${harness.id} could not be built:`, error);
      throw new Error(`the ${roleName} seat could not be built, so it was not started: ${error instanceof Error ? error.message : String(error)}`);
    }
    return team;
  }

  forget(): void {
    this.built.clear();
  }
}
