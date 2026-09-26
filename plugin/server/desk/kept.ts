import { recordEvent } from "./store/event-log.ts";
import { landedRef } from "../core/git.ts";
import { letGo } from "./gone.ts";
import { type AgentRef, type Lane, type Ledger, loadLedger, tasksOf } from "./ledger.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";

/** The Peers kept idle in a lane after their tasks were accepted: each bound to its own task and not gone, until its Lead releases it. */
export function keptPeers(ledger: Ledger, laneId: string): AgentRef[] {
  return Object.values(ledger.agents).filter((agent) => {
    const task = ledger.tasks[agent.task ?? ""];
    return (
      agent.lane === laneId &&
      !agent.gone &&
      task?.peer === agent.id &&
      task.kind === "code" &&
      task.status === "merged"
    );
  });
}

/** The copy of its own a closed lane's Lead still holds: kept at close for that Lead, and not yet on its way out. */
export function keptCopy(ledger: Ledger, lane: Lane): string | undefined {
  const slot = lane.slot ? ledger.slots[lane.slot] : undefined;
  return lane.status === "closed" && slot?.lane === lane.id && !slot.releasing ? slot.id : undefined;
}

/** How a kept copy is put away: a landed lane's branch goes with it once it is in, a dropped one stays for the Human. */
const stowOf = (project: Project, lane: Lane) => ({
  project,
  slot: lane.slot,
  ...(lane.landed ? { dropBranch: lane.branch, into: landedRef(lane.id) } : {}),
});

/** The seats of a lane let go but still ending a turn in its copy, the Lead and its Peers alike: the copy waits for them. */
function stillWriting(desk: DeskServices, ledger: Ledger, lane: Lane): string[] {
  const ids = [
    lane.lead,
    ...tasksOf(ledger, lane.id)
      .filter((task) => task.mode !== "parallel")
      .map((task) => task.peer),
  ];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && desk.roster.archiving(id)))];
}

/** Lets a closed lane's kept Lead go, and its copy once nobody is writing in it; what that did, or nothing if neither was left. */
export async function releaseKept(desk: DeskServices, project: Project, lane: Lane): Promise<string | undefined> {
  const { roster, teardowns } = desk;
  const lead = lane.lead && (await roster.seated(lane.lead)) ? lane.lead : undefined;
  const ledger = loadLedger(project.state);
  const copy = keptCopy(ledger, lane);
  if (!lead && !copy) return undefined;
  if (lead) {
    await letGo(desk, roster, project, lead);
    recordEvent(project, { kind: "seat.released", seat: lead, of: lane.id });
  }
  const writing = stillWriting(desk, ledger, lane);
  if (copy) await teardowns.putAway(stowOf(project, lane), writing);
  const put = copy
    ? `its working copy ${copy} is put away${writing.length > 0 ? ` once ${writing.join(" and ")} finish the turn they are in` : ""}`
    : "";
  return lead
    ? `Lane ${lane.id}'s Lead ${lead} is released${put ? `, and ${put}` : ""}.`
    : `Lane ${lane.id}'s Lead was gone already; ${put}.`;
}

/** Where a merged task's branch is found: under the landed ref once its lane landed, and on the lane branch before. */
const mergedInto = (lane: Lane) => (lane.landed ? landedRef(lane.id) : lane.branch);

/**
 * The round's teardown: what stopped writers held, and the copy a kept seat held once that seat is gone, archived by the
 * Human or with its superior: a kept Lead's, and a merged parallel task's kept by its Peer.
 */
export async function reapKept(desk: DeskServices, project: Project, live: Set<string>): Promise<void> {
  await desk.teardowns.reap(project, live);
  const ledger = loadLedger(project.state);
  for (const lane of Object.values(ledger.lanes)) {
    if (keptCopy(ledger, lane) && !(lane.lead && live.has(lane.lead)))
      await desk.teardowns.putAway(stowOf(project, lane), stillWriting(desk, ledger, lane));
  }
  for (const task of Object.values(ledger.tasks)) {
    const slot = task.slot ? ledger.slots[task.slot] : undefined;
    const lane = ledger.lanes[task.lane];
    if (
      !slot ||
      slot.task !== task.id ||
      slot.releasing ||
      task.status !== "merged" ||
      !lane ||
      (task.peer && live.has(task.peer))
    )
      continue;
    await desk.teardowns.putAway({ project, slot: slot.id, dropBranch: task.branch, into: mergedInto(lane) });
  }
}
