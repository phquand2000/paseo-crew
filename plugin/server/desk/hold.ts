import { recordEvent } from "./store/event-log.ts";
import { type Lane, findLane, laneSeats } from "./ledger.ts";
import { letters } from "./letters.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";

/** Why nothing may start, move or land in `lane` now: it is on hold. */
export function holdRefusal(lane: Lane): string | undefined {
  return lane.onHold
    ? `Lane ${lane.id} is on hold: ${lane.onHold.reason}. Nothing is accepted, started or landed in it until it resumes.`
    : undefined;
}

/**
 * Puts a lane on hold for `by`: each seat still working in it gets HOLD past the outbox, and a landing it waited on is called
 * off. An approval the Human already gave stands: it is for the lane as it is, and nothing lands while the hold lasts.
 */
export async function putOnHold(
  desk: DeskServices,
  project: Project,
  laneId: string,
  by: string,
  reason: string,
): Promise<{ lane: Lane; stopped: string[]; calledOff: boolean } | string> {
  const { ledgers, roster } = desk;
  const held = ledgers.transact(project, (ledger) => {
    const lane = findLane(ledger, laneId);
    if (!lane) return `There is no lane ${laneId}.`;
    if (lane.status === "closed") return `Lane ${lane.id} is closed; there is nothing to hold.`;
    if (lane.onHold)
      return `Lane ${lane.id} has been on hold since ${new Date(lane.onHold.at).toISOString().slice(11, 16)}: ${lane.onHold.reason}`;
    // A landing it was waiting to finish, or waiting for the Human to approve, would otherwise go ahead under the hold.
    const calledOff = Boolean(lane.landing || (lane.landApproval && !lane.landApproval.approved));
    delete lane.landing;
    if (!lane.landApproval?.approved) delete lane.landApproval;
    lane.onHold = { at: Date.now(), by, reason };
    return { lane: { ...lane }, seats: laneSeats(ledger, lane), calledOff };
  });
  if (typeof held === "string") return held;
  const stopped: string[] = [];
  for (const { seat, task } of held.seats)
    if (await roster.interrupt(seat, letters.onHold(held.lane, reason, task))) stopped.push(seat);
  recordEvent(project, { kind: "lane.onHold", lane: held.lane.id, by, reason, stopped });
  return { lane: held.lane, stopped, calledOff: held.calledOff };
}
