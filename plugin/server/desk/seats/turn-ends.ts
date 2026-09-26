import { errorText } from "../../core/errors.ts";
import { landLetters } from "../letters/land-letters.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { loadLedger } from "../store/ledger.ts";

type Ended = (agentId: string) => boolean;

/** What waited on turns that ended goes on: the teardowns they held up, each project's merges, and landings held for their writers. */
export async function turnsEnded(
  desk: Pick<DeskServices, "teardowns" | "projects" | "ledgers" | "mail" | "log" | "merges">,
  ended: Ended,
): Promise<void> {
  await desk.teardowns.stopped(ended);
  for (const project of desk.projects.values()) {
    desk.merges.retry(project).catch((error) => desk.log(project, `merge retry failed: ${errorText(error)}`));
    await releaseLandings(desk, project, ended);
  }
}

/** A lane whose landing waited for seats writing in its copy is told it can land once the last of them is done. */
async function releaseLandings(
  { ledgers, mail }: Pick<DeskServices, "ledgers" | "mail">,
  project: Project,
  ended: Ended,
): Promise<void> {
  const lanes = Object.values(loadLedger(project.state).lanes);
  for (const lane of lanes.filter((entry) => entry.status === "open" && entry.landing?.writers.some(ended))) {
    // Who is left is worked out where it is written: a turn that ended meanwhile must not be written back as still in the way.
    const by = ledgers.transact(project, (ledger) => {
      const entry = ledger.lanes[lane.id];
      if (!entry?.landing) return undefined;
      entry.landing.writers = entry.landing.writers.filter((id) => !ended(id));
      if (entry.landing.writers.length > 0) return undefined;
      const { by } = entry.landing;
      delete entry.landing;
      return by;
    });
    if (by) await mail.post(by, landLetters.canLand(lane));
  }
}
