import { namedOrNot, roleNamed, roleThatCan } from "../catalog/kit.ts";
import { dropMerged, headSha, switchTo } from "../core/git.ts";
import type { SeatView } from "../core/paseo.ts";
import { errorText } from "../core/errors.ts";
import { firstOverlap, serialHits, serialReach } from "../core/scope.ts";
import { IN_QUEUE, TASK } from "../domain/task.ts";
import type { Issue } from "./issue.ts";
import { type Lane, type Ledger, type Task, activeTasks, loadLedger, ownCopyHolder } from "./ledger.ts";
import { outside } from "../core/text.ts";
import { besideOf, taskBrief } from "./briefs.ts";
import { holderOf } from "./holder.ts";
import { type Elsewhere, directiveFor, elsewhereText } from "./directive.ts";
import { seatTitle } from "./names.ts";
import { type Project, loadConfig } from "./project.ts";
import { backOnLane } from "./sync.ts";
import type { DeskServices } from "./services.ts";

/** Why a lane cannot open, and what open_lane would do instead: the reason is shared, the advice is not. */
export type Refusal = { why: string; instead: string };

export function scopeProblem(serial: string[], open: Lane[], writeSet: string[], contracts: string[]): Refusal | undefined {
  if (open.length === 0) return undefined;
  const mine = serialReach(writeSet, serial);
  for (const other of open) {
    // No write set could mean any of them, and a copy of its own does not help: a merge cannot reconcile these.
    const theirs = other.writeSet.length === 0 ? serial : serialReach(other.writeSet, serial);
    const both = mine.filter((path) => theirs.includes(path));
    // Capped at four: resolved against real files, a Unity or Unreal tree can match tens of thousands.
    if (both.length > 0)
      return {
        why: `Lane ${other.id} may already be writing ${both.slice(0, 4).join(", ")}${both.length > 4 ? ` and ${both.length - 4} more` : ""}, and only one lane at a time may write those.`,
        instead: `Open this lane after ${other.id} lands, or keep those paths out of it.`,
      };
  }
  // Nothing is said when either declared nothing: that is the Supervisor's call, not a hole to refuse over.
  for (const other of open) {
    if (writeSet.length === 0 || other.writeSet.length === 0) continue;
    const clash = firstOverlap(writeSet, [...other.writeSet, ...other.contracts]) ?? firstOverlap(contracts, other.writeSet);
    if (clash) return { why: `This lane overlaps lane ${other.id} at ${clash}.`, instead: `Fold it in or open it after ${other.id} lands.` };
  }
  return undefined;
}

export const seatingKey = (project: Project, lane: string) => `${project.slug}:${lane}`;

/** A seat Paseo holds as this lane's Lead, by the labels it was started with; a Peer's and a reviewer's also name a task. */
export function leadSeatOf(seats: SeatView[], project: Project, lane: string): SeatView | undefined {
  return seats.find((seat) => seat.labels?.["seatworks.project"] === project.slug && seat.labels["seatworks.lane"] === lane && !seat.labels["seatworks.task"]);
}

export function openedReply(project: Project, lane: Lane, slot: { id?: string }, lead: string, issue: Issue | undefined, elsewhere: Elsewhere[]): string {
  // An empty gate is the owner's answer, not a missing one, so it is not an invitation to set one.
  const stored = loadConfig(project.state).gate;
  const gate = stored ? stored : stored === "" ? "none set, by this project's own choice" : "none; call set_project with the project's test command";
  const issueText = issue
    ? `\n\nIssue #${issue.number} as the Lead received it: ${outside("issue", issue.title, 200)} (${outside("issue", issue.url, 300)})\n<issue>\n${outside("issue", issue.body, 4000)}\n</issue>`
    : "";
  const where = slot.id ? `in working copy ${slot.id}` : "in the project's own working copy";
  const on = lane.onBranch
    ? `carries on ${lane.branch} ${where}${lane.branch === loadConfig(project.state).base ? `, which is the project's base: nothing separates this work from it and there is no lane branch to fall back on` : ""}`
    : `is open on ${lane.branch} (off ${lane.base}) ${where}`;
  const beside = elsewhere.length > 0 ? ` It declared no write set, so it opened beside lanes that may be writing what only one lane at a time may write: ${elsewhereText(elsewhere)}. Its Lead is told to leave those to them; amend_lane can give it a write set.` : "";
  return `Lane ${lane.id} ${on}, and its Lead ${lead} is starting. Gate: ${gate}.${beside} Reports and asks arrive as mail; nothing to wait for now.${issueText}`;
}

/** Where a lane opens given the ledger as it stands, or why it cannot: decided in the transaction that records or opens it. */
export function placement(ledger: Ledger, lane: Pick<Lane, "onBranch" | "writeSet" | "contracts" | "detourOf">, isolate: boolean, serial: string[], self?: string): { ownCopy: boolean } | Refusal {
  const lanes = Object.values(ledger.lanes).filter((entry) => entry.id !== self);
  const open = lanes.filter((entry) => entry.status === "open");
  const holder = ownCopyHolder(lanes);
  if (lane.onBranch && holder) return { why: `Lane ${holder.id} is working in the project's own copy on ${holder.branch}, and one checkout holds one branch.`, instead: `Carry this branch on once ${holder.id} closes, or open the lane on a branch of its own.` };
  // A detour must name a real open lane, or the letter back out of it has nowhere to go.
  if (lane.detourOf && !open.some((entry) => entry.id === lane.detourOf)) return { why: `There is no open lane ${lane.detourOf} for this one to clear the way for.`, instead: "" };
  const problem = scopeProblem(serial, open, lane.writeSet, lane.contracts);
  if (problem) return problem;
  // One checkout is one branch, so whether to wait for it or take a copy is the Supervisor's call; a detour cannot wait.
  if (holder && !isolate && !lane.onBranch && !lane.detourOf) {
    return holder.status === "open"
      ? { why: `Lane ${holder.id} is working in the project's own copy on ${holder.branch}.`, instead: `Pass isolate to open this lane in a copy of its own now, or open it with after ${holder.id} to work in the project's copy once that lane lands.` }
      : { why: `Lane ${holder.id} is closed, but its Lead is still ending a turn in the project's own copy, which goes back to ${holder.base} when that turn ends.`, instead: "Pass isolate to open this lane in a copy of its own now, or open it again once status shows the copy is back." };
  }
  return { ownCopy: !lane.onBranch && (isolate || holder !== undefined) };
}

type Seating = { ownCopy: boolean; from?: string; role?: string; parent?: string; issue?: Issue };
type Seated = { slot: { id?: string; path: string; workspaceId?: string }; lead: string; elsewhere: Elsewhere[] };

/** Seats the Lead of a lane marked seating; a failure puts back what it took, moves the lane by `failed`, and comes back as the reason. */
export async function startLead(desk: DeskServices, project: Project, lane: Lane, how: Seating & { failed: "close" | "wait" }): Promise<Seated | string> {
  const { ctx } = desk;
  try {
    const started = await seatLead(desk, project, lane, how);
    if (typeof started === "string") ctx.moveLane(project, lane.id, how.failed);
    return started;
  } finally {
    ctx.seating.delete(seatingKey(project, lane.id));
  }
}

async function seatLead(desk: DeskServices, project: Project, lane: Lane, how: Seating): Promise<Seated | string> {
  const { ctx, slots, agents } = desk;
  const giveBack = async (taken: { id?: string }) => {
    if (taken.id) await slots.release(project, taken.id, lane.branch, lane.base);
    else if (how.from) await slots.unstart(project, how.from, lane.branch);
    else if (!lane.onBranch) await slots.giveBack(project, lane.base, lane.branch);
  };
  let slot: { id?: string; path: string; workspaceId?: string };
  try {
    slot = lane.onBranch ? await slots.carryOn(project, lane.branch, how.from) : how.ownCopy ? await slots.acquire(project, lane.branch, lane.base, { lane: lane.id }, `${lane.id} ${lane.title}`) : await slots.inPlace(project, lane.branch, lane.base);
  } catch (error) {
    return `The lane could not get a working copy: ${errorText(error)}`;
  }
  try {
    const leadRole = roleThatCan(ctx.kit, "lead", how.role || undefined);
    if (!leadRole) {
      await giveBack(slot);
      return namedOrNot(ctx.kit, "lead", how.role ?? "", "lead a lane");
    }
    const directed = await directiveFor(ctx.kit, project, lane, slot.path, how.issue);
    const startSha = lane.onBranch ? await headSha(slot.path) : undefined;
    // Where the Lead works goes on record before it starts, so a lane a stop leaves without its Lead still knows.
    ctx.transact(project, (ledger) => {
      Object.assign(ledger.lanes[lane.id] ?? {}, { worktree: slot.path, slot: slot.id, workspaceId: slot.workspaceId, startSha });
    });
    const lead = await agents.start(project, slot, leadRole.role, {
      parent: how.parent,
      title: seatTitle.of(lane, leadRole),
      prompt: directed.text,
      labels: { "seatworks.lane": lane.id, "seatworks.role": leadRole.role },
    });
    ctx.transact(project, (ledger) => {
      const entry = ledger.lanes[lane.id];
      if (entry) entry.lead = lead;
      ledger.agents[lead] = { id: lead, role: leadRole.role, lane: lane.id };
    });
    ctx.event(project, { kind: "lane.opened", lane: lane.id, lead, branch: lane.branch, base: lane.base, slot: slot.id ?? "in place" });
    return { slot, lead, elsewhere: directed.elsewhere };
  } catch (error) {
    await giveBack(slot);
    ctx.transact(project, (ledger) => forgetPlace(ledger.lanes[lane.id]));
    return `The Lead could not start: ${errorText(error)}`;
  }
}

/** Drops the copy a lane took for a Lead that never started: it has been given back, and the lane waits or closes without it. */
export function forgetPlace(lane: Lane | undefined): void {
  if (!lane) return;
  delete lane.worktree;
  delete lane.slot;
  delete lane.workspaceId;
  delete lane.startSha;
}

/** Where a task may start in its lane, or why not: decided in the transaction that starts it. `holds` and `serial` count for a parallel task. */
export function taskPlacement(ledger: Ledger, lane: Lane, holds: string[], parallel: boolean, serial: string[]): Refusal | undefined {
  if (!parallel) {
    const holder = holderOf(ledger, lane);
    if (!holder) return undefined;
    const beside = "or run this beside it in parallel, holding paths independent of it.";
    if (holder.status === "done" || holder.status === "failed") {
      const waits = holder.status === "done" ? "has handed back" : "failed to merge";
      return { why: `${holder.id} ${waits} and is waiting on you, and it still holds the lane's working copy — rework would wake its Peer in there.`, instead: `Accept or cut it first, ${beside}` };
    }
    const doing = IN_QUEUE.includes(holder.status) ? "is in the merge queue, and holds the lane's working copy until it merges." : "is still writing in the lane's working copy, and it holds one writer at a time.";
    return { why: `${holder.id} ${doing}`, instead: `Pass after ${holder.id} to start this once it is merged, ${beside}` };
  }
  return parallelProblem(ledger, lane, holds, serial);
}

/** What a parallel task holding these paths would collide with: a path one writer at a time may write, or what a task beside it holds. */
export function parallelProblem(ledger: Ledger, lane: Lane, holds: string[], serial: string[], self?: string): Refusal | undefined {
  const hits = serialHits(holds, serial);
  if (hits.length > 0) return { why: `A parallel task can't hold ${hits.join(", ")}.`, instead: "Run it in the lane's working copy instead." };
  for (const task of activeTasks(ledger, lane.id).filter((entry) => entry.kind === "code" && entry.id !== self)) {
    const clash = firstOverlap(holds, task.holds);
    if (clash) return { why: `What it holds overlaps what ${task.id} holds at ${clash}.`, instead: `Pass after ${task.id} instead of running it in parallel.` };
  }
  return undefined;
}

/** Seats the Peer of a task recorded running; a failure gives back its copy, moves it by `failed`, and comes back as the reason. */
export async function startPeer(desk: DeskServices, project: Project, lane: Lane, task: Task, how: { role: string; parent?: string; failed: "cut" | "wait" }): Promise<{ peer: string; where: string } | string> {
  const { ctx, slots, agents } = desk;
  const parallel = task.mode === "parallel";
  try {
    let slot: { id?: string; path: string; workspaceId?: string };
    if (parallel) {
      slot = await slots.acquire(project, task.branch!, lane.branch, { task: task.id }, `${task.id} ${task.title}`);
      ctx.setTask(project, task.id, (entry) => Object.assign(entry, { slot: slot.id, worktree: slot.path }));
    } else {
      slot = lane.slot ? loadLedger(project.state).slots[lane.slot]! : { path: lane.worktree!, workspaceId: lane.workspaceId };
      // The lane's copy takes the task's own branch, made from the lane as it stands; the lane branch moves only by merges.
      const refused = await switchTo(slot.path, task.branch!, task.startSha ?? lane.branch);
      if (refused) throw new Error(`the lane's working copy could not go onto ${task.branch}: ${refused}`);
    }
    const peer = await agents.start(project, slot, how.role, {
      parent: how.parent,
      title: seatTitle.of(task, roleNamed(ctx.kit, how.role)!),
      prompt: taskBrief(task, lane, besideOf(loadLedger(project.state), task)),
      labels: { "seatworks.lane": lane.id, "seatworks.task": task.id, "seatworks.role": how.role },
    });
    ctx.setTask(project, task.id, (entry) => {
      entry.peer = peer;
    });
    ctx.transact(project, (current) => {
      current.agents[peer] = { id: peer, role: how.role, lane: lane.id, task: task.id };
    });
    ctx.event(project, { kind: "task.started", task: task.id, peer, mode: task.mode, slot: slot.id ?? "in place" });
    return { peer, where: parallel ? `in its own working copy ${slot.id} on ${task.branch}` : `in the lane's working copy on ${task.branch}` };
  } catch (error) {
    const taken = loadLedger(project.state).tasks[task.id]?.slot;
    ctx.setTask(project, task.id, (entry) => {
      TASK.move(entry, how.failed);
      if (parallel) {
        delete entry.slot;
        delete entry.worktree;
      }
    });
    if (parallel) await slots.release(project, taken, task.branch, lane.branch);
    else if (!(await backOnLane(lane))) await dropMerged(lane.worktree!, task.branch!, lane.branch);
    return `The Peer could not start: ${errorText(error)}`;
  } finally {
    ctx.seating.delete(seatingKey(project, task.id));
  }
}
