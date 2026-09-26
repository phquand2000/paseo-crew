import { headSha } from "../../core/git.ts";
import { type ToolReply, no, ok } from "../context.ts";
import { landLetters } from "../letters/land-letters.ts";
import { type Lane, loadLedger } from "../store/ledger.ts";
import type { Project } from "../project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { closeLane } from "./closing.ts";
import type { Held } from "./land-hold.ts";

type Tell = (how: Parameters<typeof landLetters.landDecided>[1], text: string) => Promise<unknown>;

/**
 * The Human's word on a held landing. Approved, the desk lands it now for the Supervisor, and what stops it leaves the
 * approval for the next land_lane; sent back, the lane stays open with their note.
 */
export async function decideLand(
  desk: DeskServices,
  project: Project,
  laneId: string,
  approve: boolean,
  note: string,
): Promise<ToolReply> {
  const lane = loadLedger(project.state).lanes[laneId];
  const none = no(`Lane ${laneId} has no landing waiting for your approval.`);
  if (lane?.status !== "open" || !lane.landApproval || lane.landApproval.approved) return none;
  const decided = recordDecision(desk, project, laneId, approve, note, await headSha(project.root, lane.branch));
  if (!decided) return none;
  const supervisor = await desk.roster.supervisorFor(project, lane.opener);
  const tell: Tell = (how, text) => desk.mail.post(supervisor, landLetters.landDecided(lane, how, text));
  if (decided.changed) {
    await tell("changed", "");
    return ok(
      `Lane ${laneId} changed after it was held, so this approval is not for what it holds now. It is checked again when the Supervisor lands it.`,
    );
  }
  recordEvent(project, { kind: approve ? "land.approved" : "land.sentBack", lane: laneId });
  if (!approve) {
    await desk.mail.post(lane.lead, landLetters.landSentBack(lane, note, decided.held.head));
    await tell("sent back", note);
    return ok(`Lane ${laneId} is sent back to its Lead with your note; it stays open.`);
  }
  return landApproved(desk, project, lane, supervisor ?? lane.opener, decided.held, note, tell);
}

/** Decided where it is written: two decisions at once both acted on one hold, and it landed twice. */
function recordDecision(
  { ledgers }: Pick<DeskServices, "ledgers">,
  project: Project,
  laneId: string,
  approve: boolean,
  note: string,
  tip: string | undefined,
): { held: Held; changed: boolean } | undefined {
  return ledgers.transact(project, (current) => {
    const entry = current.lanes[laneId];
    const held = entry?.status === "open" ? entry.landApproval : undefined;
    if (!entry || !held || held.approved) return undefined;
    const changed = held.head !== tip;
    if (approve && !changed) held.approved = { at: Date.now(), note };
    else delete entry.landApproval;
    // Sent back, it is no longer what its Lead reported ready: the note asks for more.
    if (!approve && !changed) delete entry.ready;
    return { held: { ...held }, changed };
  });
}

async function landApproved(
  desk: DeskServices,
  project: Project,
  lane: Lane,
  by: string,
  held: Held,
  note: string,
  tell: Tell,
): Promise<ToolReply> {
  const closed = await closeLane(desk, project, by, {
    lane: lane.id,
    land: true,
    overGate: held.overGate,
    reason: held.reason,
  });
  const now = loadLedger(project.state).lanes[lane.id];
  if (now?.status === "closed") {
    await tell("landed", `${note ? `${note}. ` : ""}${closed.text}`);
    return ok(`Approved: ${closed.text}`);
  }
  if (now?.landApproval && !now.landApproval.approved) {
    await tell("again", closed.text);
    return ok(`Approved, but landing lane ${lane.id} turned up more, so it waits for you again: ${closed.text}`);
  }
  const blocked = closed.blocked ?? closed.text;
  await tell("blocked", blocked);
  return ok(`Approved. It could not land yet: ${blocked}. The Supervisor lands it once that is cleared.`);
}
