import type { DeskContext } from "./context.ts";
import type { Project } from "./project.ts";
import type { Roster } from "./roster.ts";

/** Marks a seat's binding gone: from here on nothing hands it work or counts it as kept, whatever Paseo lists meanwhile. */
export function markGone(ctx: DeskContext, project: Project, agentId: string): void {
  ctx.transact(project, (ledger) => {
    const bound = ledger.agents[agentId];
    if (bound) bound.gone = true;
  });
}

/** Lets a seat of the team go: its binding says so before Paseo archives it, which waits for a turn under way unless forced. */
export async function letGo(
  ctx: DeskContext,
  roster: Roster,
  project: Project,
  agentId: string | undefined,
  force = false,
): Promise<void> {
  if (!agentId) return;
  markGone(ctx, project, agentId);
  await roster.archive(agentId, force);
}
