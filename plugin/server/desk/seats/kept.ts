import { landedRef } from "../../core/git.ts";
import { IN_QUEUE } from "../../domain/task.ts";
import { laneTask } from "../access.ts";
import { type Args, type Caller, type ToolReply, no, ok, str } from "../context.ts";
import { claimGone, letGo } from "./gone.ts";
import { type AgentRef, type Ledger, findLane, findTask, tasksOf } from "../../domain/ledger.ts";
import { keptLetters } from "../letters/kept-letters.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";

/** The Peers kept idle in a lane after their tasks were accepted: each bound to its own task and not gone, until its Lead releases it. */
export function keptPeers(ledger: Ledger, laneId: string): AgentRef[] {
  return Object.values(ledger.agents).filter((agent) => {
    const task = ledger.tasks[agent.task ?? ""];
    return agent.lane === laneId && task !== undefined && keptFrom(ledger, task) === agent;
  });
}

/** The Peer kept from a merged task, while it is not gone and has not taken another task. */
function keptFrom(ledger: Ledger, task: Task): AgentRef | undefined {
  const agent = task.peer ? ledger.agents[task.peer] : undefined;
  return agent && !agent.gone && agent.task === task.id && task.kind === "code" && task.status === "merged"
    ? agent
    : undefined;
}

/** The Peer kept from `source` that a task of `role` may start on: one that worked in the lane's copy, as the task will. */
export function keptFor(ledger: Ledger, source: Task | undefined, role: string): AgentRef | string {
  if (!source) return "is no task of this lane";
  if (source.mode === "parallel") return `ran in a copy of its own, and its Peer cannot move into the lane's`;
  const agent = keptFrom(ledger, source);
  if (!agent) return "has no Peer kept: it is not merged, or its Peer is gone or took another task";
  return agent.role === role ? agent : `was a ${agent.role}'s, not a ${role}'s`;
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
async function releaseClosedLead(desk: DeskServices, project: Project, lane: Lane): Promise<string | undefined> {
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

/** A Lead lets go of the Peer kept from a task it accepted, and of a copy of its own with it. */
export async function releaseKeptPeer(desk: DeskServices, caller: Caller, args: Args): Promise<ToolReply> {
  const ledger = loadLedger(caller.project.state);
  const found = laneTask(ledger, caller, str(args.task));
  return typeof found === "string" ? no(found) : releaseTaskPeer(desk, caller.project, ledger, found);
}

/** Why the Peer kept from `task` cannot go now, or that Peer. */
async function keptToRelease(desk: DeskServices, ledger: Ledger, task: Task): Promise<string | { peer: string }> {
  if (task.kind === "review") return `${task.id} is a review: its reviewer goes when you cut it.`;
  if (task.status === "cut") return `${task.id} was cut, and its Peer stopped with it.`;
  if (IN_QUEUE.includes(task.status)) return `${task.id} is in the merge queue: release its Peer once MERGED arrives.`;
  if (task.status !== "merged")
    return `${task.id} is ${task.status}: accept it first, or cut it, which stops its Peer.`;
  const peer = task.peer!;
  const moved = ledger.agents[peer]?.task;
  if (moved && moved !== task.id)
    return `The Peer kept from ${task.id} took ${moved} since: it is that task's Peer now.`;
  if (!(await desk.roster.seated(peer))) return `The Peer kept from ${task.id} is gone already.`;
  const reading = Object.values(ledger.tasks).find(
    (other) =>
      other.kind === "review" && other.of === task.id && other.slot === task.slot && other.status === "running",
  );
  if (task.mode === "parallel" && reading) return `${reading.id} still reviews ${task.id} in its copy: cut it first.`;
  return { peer };
}

/** Lets the Peer kept from `task` go, its Lead told first when `by` is whoever supervises and not that Lead. */
async function releaseTaskPeer(
  desk: DeskServices,
  project: Project,
  ledger: Ledger,
  { lane, task }: { lane: Lane; task: Task },
  by?: string,
): Promise<ToolReply> {
  const kept = await keptToRelease(desk, ledger, task);
  if (typeof kept === "string") return no(kept);
  const parallel = task.mode === "parallel";
  // Checked where it is written: a task started on this Peer since the read above keeps it.
  if (!parallel && !claimGone(desk, project, kept.peer, task.id)) {
    const took = loadLedger(project.state).agents[kept.peer]?.task;
    return no(`The Peer kept from ${task.id} took ${took} since: it is that task's Peer now.`);
  }
  if (by) await desk.mail.post(lane.lead, keptLetters.released(task, kept.peer, by));
  if (parallel) await desk.agents.retire(project, task, lane.branch);
  else await desk.roster.archive(kept.peer);
  recordEvent(project, { kind: "seat.released", seat: kept.peer, of: task.id });
  return ok(
    `The Peer kept from ${task.id} is released${parallel ? `, and its copy ${task.slot} is put away with it` : ""}.`,
  );
}

/** An open lane's Lead let go: its copy, branch, tasks and Peers stay as they are for the Lead replace_lead seats. */
async function releaseOpenLead(desk: DeskServices, project: Project, lane: Lane): Promise<ToolReply> {
  const lead = lane.lead && (await desk.roster.seated(lane.lead)) ? lane.lead : undefined;
  if (!lead) return no(`Lane ${lane.id}'s Lead is gone already: replace_lead seats another where the lane stands.`);
  await letGo(desk, desk.roster, project, lead);
  recordEvent(project, { kind: "seat.released", seat: lead, of: lane.id });
  const after = desk.roster.archiving(lead) ? " It is archived once the turn it is in ends." : "";
  return ok(
    `Lane ${lane.id}'s Lead ${lead} is released; the lane stays open where it stands, for replace_lead to seat another.${after}`,
  );
}

/**
 * Whoever supervises lets go of a lane's Lead, or of the Peer kept from a task in any lane: a Lead kept from a closed lane
 * goes with the copy it kept, and one of a lane still open leaves the lane where it stands for another.
 */
export async function releaseKept(desk: DeskServices, caller: Caller, args: Args): Promise<ToolReply> {
  const ledger = loadLedger(caller.project.state);
  if (!args.lane === !args.task)
    return no("Name a lane to release its Lead, or a task to release the Peer kept from it.");
  if (args.task) {
    const task = findTask(ledger, str(args.task));
    const lane = task && ledger.lanes[task.lane];
    if (!task || !lane) return no(`There is no task ${str(args.task)}.`);
    return releaseTaskPeer(desk, caller.project, ledger, { lane, task }, caller.id);
  }
  const lane = findLane(ledger, str(args.lane));
  if (!lane) return no(`There is no lane ${str(args.lane)}.`);
  if (lane.status === "waiting") return no(`Lane ${lane.id} is waiting, and has no Lead yet.`);
  if (lane.status === "open") return releaseOpenLead(desk, caller.project, lane);
  const released = await releaseClosedLead(desk, caller.project, lane);
  return released ? ok(released) : no(`Lane ${lane.id}'s Lead is gone already, and nothing of it is kept.`);
}
