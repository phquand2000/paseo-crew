import { landedRef } from "../core/git.ts";
import { besideOf } from "./briefs.ts";
import { letGo } from "./gone.ts";
import { keptLetters } from "./kept-letters.ts";
import { type AgentRef, type Lane, type Ledger, type Task, loadLedger, tasksOf } from "./ledger.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";

/** The Peer kept idle in a lane's copy: bound to the lane, and its task there accepted and still naming it. */
export function keptPeer(ledger: Ledger, laneId: string): AgentRef | undefined {
  return Object.values(ledger.agents).find((agent) => {
    const task = ledger.tasks[agent.task ?? ""];
    return agent.lane === laneId && !agent.gone && task?.peer === agent.id && task.kind === "code" && task.mode === "lane" && task.status === "merged";
  });
}

/**
 * Whom a task starting in the lane's copy goes to: the kept Peer, unless the task asks for a fresh one, needs another role,
 * the team now starts that role as another agent, model or thinking, or the Peer is gone.
 */
export async function keptTaker(desk: DeskServices, project: Project, kept: AgentRef | undefined, task: Task): Promise<string | undefined> {
  if (!kept || task.opening?.fresh || kept.role !== task.opening?.role) return undefined;
  if (!kept.startedAs || kept.startedAs !== desk.agents.startsAs(project, kept.role)) return undefined;
  return (await desk.roster.seated(kept.id)) ? kept.id : undefined;
}

/** Mails a task's brief to the kept Peer the claim bound it to, and records the hand-off. */
export async function handOver(desk: DeskServices, project: Project, lane: Lane, task: Task, from: string): Promise<void> {
  await desk.ctx.post(task.peer, keptLetters.brief(task, lane, besideOf(loadLedger(project.state), task)));
  desk.ctx.event(project, { kind: "task.handed", task: task.id, peer: task.peer!, from });
}

/** The copy of its own a closed lane's Lead still holds: kept at close for that Lead, and not yet on its way out. */
export function keptCopy(ledger: Ledger, lane: Lane): string | undefined {
  const slot = lane.slot ? ledger.slots[lane.slot] : undefined;
  return lane.status === "closed" && slot?.lane === lane.id && !slot.releasing ? slot.id : undefined;
}

/** How a kept copy is put away: a landed lane's branch goes with it once it is in, a dropped one stays for the Human. */
const stowOf = (project: Project, lane: Lane) => ({ project, slot: lane.slot, ...(lane.landed ? { dropBranch: lane.branch, into: landedRef(lane.id) } : {}) });

/** The seats of a lane let go but still ending a turn in its copy, the Lead and its Peers alike: the copy waits for them. */
function stillWriting(desk: DeskServices, ledger: Ledger, lane: Lane): string[] {
  const ids = [lane.lead, ...tasksOf(ledger, lane.id).filter((task) => task.mode !== "parallel").map((task) => task.peer)];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && desk.roster.archiving(id)))];
}

/** Lets a closed lane's kept Lead go, and its copy once nobody is writing in it; what that did, or nothing if neither was left. */
export async function releaseKept(desk: DeskServices, project: Project, lane: Lane): Promise<string | undefined> {
  const { ctx, roster, slots } = desk;
  const lead = lane.lead && (await roster.seated(lane.lead)) ? lane.lead : undefined;
  const ledger = loadLedger(project.state);
  const copy = keptCopy(ledger, lane);
  if (!lead && !copy) return undefined;
  if (lead) {
    await letGo(ctx, roster, project, lead);
    ctx.event(project, { kind: "seat.released", seat: lead, of: lane.id });
  }
  const writing = stillWriting(desk, ledger, lane);
  if (copy) await slots.putAway(stowOf(project, lane), writing);
  const put = copy ? `its working copy ${copy} is put away${writing.length > 0 ? ` once ${writing.join(" and ")} finish the turn they are in` : ""}` : "";
  return lead ? `Lane ${lane.id}'s Lead ${lead} is released${put ? `, and ${put}` : ""}.` : `Lane ${lane.id}'s Lead was gone already; ${put}.`;
}

/** The round's teardown: what stopped writers held, and the copy a kept Lead held once that Lead is gone, archived by the Human or with its Supervisor. */
export async function reapKept(desk: DeskServices, project: Project, live: Set<string>): Promise<void> {
  await desk.slots.reap(project, live);
  const ledger = loadLedger(project.state);
  for (const lane of Object.values(ledger.lanes)) {
    if (keptCopy(ledger, lane) && !(lane.lead && live.has(lane.lead))) await desk.slots.putAway(stowOf(project, lane), stillWriting(desk, ledger, lane));
  }
}
