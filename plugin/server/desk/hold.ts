import { type Caller, type ToolReply, no, ok, str } from "./context.ts";
import { type Lane, findLane, laneSeats } from "./ledger.ts";
import { letters } from "./letters.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";
import { recordEvent } from "./store/event-log.ts";
import { openWaiting } from "./waiting/lanes.ts";
import { startWaiting } from "./waiting/tasks.ts";

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

/** Stops a lane where it stands for whoever supervises it, and says who was told to stop. */
export async function holdLane(desk: DeskServices, caller: Caller, lane: string, reason: string): Promise<ToolReply> {
  const held = await putOnHold(desk, caller.project, lane, caller.id, reason);
  if (typeof held === "string") return no(held);
  const landing = held.calledOff ? " The landing it was waiting on is called off: land it again once it resumes." : "";
  return ok(
    `Lane ${held.lane.id} is on hold. ${held.stopped.length} of its seats were told to stop: where their agent allows it the running turn was cut short, else they stop when it ends. Nothing reaches them, no task starts and nothing lands until resume_lane.${landing}`,
  );
}

/** Lifts a hold: each seat of the lane is told to carry on, with the mail held for it, and what waited on the lane may start. */
export async function resumeLane(desk: DeskServices, caller: Caller, laneId: string, note: string): Promise<ToolReply> {
  const { project } = caller;
  const lifted = desk.ledgers.transact(project, (ledger) => {
    const lane = findLane(ledger, laneId);
    if (!lane?.onHold) return `Lane ${lane?.id ?? str(laneId)} is not on hold.`;
    delete lane.onHold;
    return { lane: { ...lane }, seats: laneSeats(ledger, lane) };
  });
  if (typeof lifted === "string") return no(lifted);
  for (const { seat, task } of lifted.seats) await desk.mail.post(seat, letters.resumed(lifted.lane, note, task));
  recordEvent(project, { kind: "lane.resumed", lane: lifted.lane.id, by: caller.id });
  await openWaiting(desk, project, true);
  await startWaiting(desk, project, true);
  await desk.merges.retry(project);
  return ok(`Lane ${lifted.lane.id} resumes: each of its seats is told to carry on, with what was held for it.`);
}
