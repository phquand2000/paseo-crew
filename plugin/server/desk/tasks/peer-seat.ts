import { roleNamed } from "../../catalog/kit/roles.ts";
import { errorText } from "../../core/errors.ts";
import { dropMerged, switchTo } from "../../core/git.ts";
import { TASK } from "../../domain/task.ts";
import { besideOf, taskBrief } from "../briefs.ts";
import { workKey } from "../claims.ts";
import { type Lane, type Task, loadLedger } from "../ledger.ts";
import { seatTitle } from "../names.ts";
import type { Project } from "../project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { backOnLane } from "../sync.ts";

type Copy = { id?: string; path: string; workspaceId?: string };

/** Seats the Peer of a task recorded running; a failure gives back its copy, sets it waiting again, and is the reason. */
export async function startPeer(
  desk: DeskServices,
  project: Project,
  lane: Lane,
  task: Task,
  how: { role: string; parent?: string },
): Promise<{ peer: string; where: string } | string> {
  const { kit, ledgers, agents } = desk;
  try {
    const copy = await peerCopy(desk, project, lane, task);
    const peer = await agents.start(project, copy, how.role, {
      parent: how.parent,
      title: seatTitle.of(task, roleNamed(kit, how.role)!),
      prompt: taskBrief(task, lane, besideOf(loadLedger(project.state), task)),
      labels: { "seatworks.lane": lane.id, "seatworks.task": task.id, "seatworks.role": how.role },
    });
    ledgers.transact(project, (ledger) => {
      const entry = ledger.tasks[task.id];
      if (entry) Object.assign(entry, { peer, updatedAt: Date.now() });
      ledger.agents[peer] = { id: peer, role: how.role, lane: lane.id, task: task.id };
    });
    recordEvent(project, { kind: "task.started", task: task.id, peer, mode: task.mode, slot: copy.id ?? "in place" });
    const where =
      task.mode === "parallel"
        ? `in its own working copy ${copy.id} on ${task.branch}`
        : `in the lane's working copy on ${task.branch}`;
    return { peer, where };
  } catch (error) {
    await putBack(desk, project, lane, task);
    return `The Peer could not start: ${errorText(error)}`;
  } finally {
    desk.seating.release(workKey(project, task.id));
  }
}

/** The copy a Peer works in: its own for a task beside others, else the lane's, switched to the task's own branch. */
async function peerCopy(
  { ledgers, slots }: Pick<DeskServices, "ledgers" | "slots">,
  project: Project,
  lane: Lane,
  task: Task,
): Promise<Copy> {
  if (task.mode === "parallel") {
    const slot = await slots.acquire(project, task.branch!, lane.branch, { task: task.id }, `${task.id} ${task.title}`);
    ledgers.setTask(project, task.id, (entry) => Object.assign(entry, { slot: slot.id, worktree: slot.path }));
    return slot;
  }
  const copy = lane.slot
    ? loadLedger(project.state).slots[lane.slot]!
    : { path: lane.worktree!, workspaceId: lane.workspaceId };
  // The lane's copy takes the task's own branch, made from the lane as it stands; the lane branch moves only by merges.
  const refused = await switchTo(copy.path, task.branch!, task.startSha ?? lane.branch);
  if (refused) throw new Error(`the lane's working copy could not go onto ${task.branch}: ${refused}`);
  return copy;
}

/** A Peer that did not start leaves its task waiting, and the copy it was given as it was. */
async function putBack(
  { ledgers, slots }: Pick<DeskServices, "ledgers" | "slots">,
  project: Project,
  lane: Lane,
  task: Task,
): Promise<void> {
  const parallel = task.mode === "parallel";
  const taken = loadLedger(project.state).tasks[task.id]?.slot;
  ledgers.setTask(project, task.id, (entry) => {
    TASK.move(entry, "wait");
    if (parallel) {
      delete entry.slot;
      delete entry.worktree;
    }
  });
  if (parallel) await slots.release(project, taken, task.branch, lane.branch);
  else if (!(await backOnLane(lane))) await dropMerged(lane.worktree!, task.branch!, lane.branch);
}
