import { readLedger } from "../store/ledger.ts";
import type { DeskBase } from "../base.ts";
import type { Project } from "../project/project.ts";
import type { Roster } from "./roster.ts";

/** Marks a seat's binding gone: from here on nothing hands it work or counts it as kept, whatever Paseo lists meanwhile. */
export function markGone({ ledgers }: Pick<DeskBase, "ledgers">, project: Project, agentId: string): void {
  // Paseo tells of every agent archived: one no project binds must not leave a project on record.
  if (!readLedger(project.state).agents[agentId]) return;
  ledgers.transact(project, (ledger) => {
    const bound = ledger.agents[agentId];
    if (!bound) return;
    bound.gone = true;
    delete bound.limited;
  });
}

/** Marks the Peer kept from `task` gone in the write that finds it still there: false once it took another task meanwhile. */
export function claimGone(
  { ledgers }: Pick<DeskBase, "ledgers">,
  project: Project,
  peer: string,
  task: string,
): boolean {
  return ledgers.transact(project, (ledger) => {
    const bound = ledger.agents[peer];
    if (bound?.task !== task) return false;
    bound.gone = true;
    delete bound.limited;
    return true;
  });
}

/** Lets a seat of the team go:its binding says so before Paseo archives it, which waits for a turn under way unless forced. */
export async function letGo(
  desk: Pick<DeskBase, "ledgers">,
  roster: Roster,
  project: Project,
  agentId: string | undefined,
  force = false,
): Promise<void> {
  if (!agentId) return;
  markGone(desk, project, agentId);
  await roster.archive(agentId, force);
}
