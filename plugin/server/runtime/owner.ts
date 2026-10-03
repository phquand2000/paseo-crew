import type { RoleSpec } from "../catalog/kit/kit.ts";
import { can } from "../catalog/kit/roles.ts";
import type { Desk } from "../desk/desk.ts";
import type { Project } from "../desk/project/project.ts";
import { loadLedger } from "../desk/store/ledger.ts";
import { laneOfLead, taskOfPeer } from "../domain/ledger.ts";

/** Who answers for a seat: whoever supervises a Lead, a Peer's Lead, or whoever supervises once that Lead is gone. */
export async function ownerOf(
  desk: Pick<Desk, "supervisorFor" | "readerOf">,
  project: Project,
  agentId: string,
  role: RoleSpec,
): Promise<{ to: string | undefined; reader: "lead" | "supervisor" | "leadGone" }> {
  // An unreadable ledger must not stop a Lead's failures reaching anyone.
  if (can(role, "lead")) {
    let opener: string | undefined;
    try {
      opener = laneOfLead(loadLedger(project.state), agentId)?.opener;
    } catch {
      // No opener then: whoever supervises the project is asked.
    }
    return { to: await desk.supervisorFor(project, opener), reader: "supervisor" };
  }
  const ledger = loadLedger(project.state);
  const task = taskOfPeer(ledger, agentId);
  if (!task) return { to: undefined, reader: "lead" };
  // A Lead no longer seated would never read it: whoever supervises is told, and can seat one.
  const reader = await desk.readerOf(project, ledger.lanes[task.lane]);
  return { to: reader.to, reader: reader.as === "lead" ? "lead" : "leadGone" };
}
