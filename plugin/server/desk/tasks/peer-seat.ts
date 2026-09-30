import { roleNamed } from "../../catalog/kit/roles.ts";
import { errorText } from "../../core/errors.ts";
import { mergeBranch } from "../../core/git-merge.ts";
import { dropMerged, git, headSha, switchTo } from "../../core/git.ts";
import { TASK } from "../../domain/task.ts";
import { besideOf, taskBrief } from "../letters/briefs.ts";
import { keptLetters } from "../letters/kept-letters.ts";
import { workKey } from "../claims.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { seatTitle } from "../seats/names.ts";
import { type Project, gitTimeout } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { backOnLane } from "../copies/sync.ts";
import { closeIncidentsOf } from "../watch/notice.ts";

type Copy = { id?: string; path: string; workspaceId?: string };

/**
 * Seats the Peer of a task recorded running, or briefs the kept Peer it starts on; a failure gives back its copy, sets it
 * waiting again, and is the reason.
 */
export async function startPeer(
  desk: DeskServices,
  project: Project,
  lane: Lane,
  task: Task,
  how: { role: string; parent?: string; kept?: { peer: string; from: string } },
): Promise<{ peer: string; where: string } | string> {
  const { kit, agents, mail } = desk;
  try {
    const copy = await peerCopy(desk, project, lane, task);
    const now = loadLedger(project.state);
    const brief = taskBrief(now.tasks[task.id] ?? task, lane, besideOf(now, task));
    const peer =
      how.kept?.peer ??
      (await agents.start(project, copy, how.role, {
        parent: how.parent,
        title: seatTitle.of(task, roleNamed(kit, how.role)!),
        prompt: brief,
        labels: { "crew.lane": lane.id, "crew.task": task.id, "crew.role": how.role },
      }));
    bind(desk, project, lane, task, { ...how, peer });
    if (how.kept) {
      closeKept(desk, project, peer);
      await mail.post(peer, keptLetters.next(task, how.kept.from, brief));
    }
    const slot = copy.id ?? "in place";
    recordEvent(project, {
      kind: "task.started",
      task: task.id,
      peer,
      mode: task.mode,
      slot,
      keptFrom: how.kept?.from,
    });
    const where =
      task.mode === "parallel"
        ? `in its own working copy ${copy.id} on ${task.branch}`
        : `in the lane's working copy on ${task.branch}${how.kept ? `, on the Peer kept from ${how.kept.from}` : ""}`;
    return { peer, where };
  } catch (error) {
    await putBack(desk, project, lane, task);
    return `The Peer could not start: ${errorText(error)}`;
  } finally {
    desk.seating.release(workKey(project, task.id));
  }
}

/** Binds the task and its Peer in one write; a kept Peer let go, or given other work, since it was named refuses. */
function bind(
  { ledgers }: Pick<DeskServices, "ledgers">,
  project: Project,
  lane: Lane,
  task: Task,
  how: { role: string; peer: string; kept?: { from: string } },
): void {
  const { peer, kept } = how;
  ledgers.transact(project, (ledger) => {
    if (kept && ledger.agents[peer]?.gone) throw new Error(`the Peer kept from ${kept.from} was let go meanwhile`);
    if (kept && ledger.agents[peer]?.task !== kept.from)
      throw new Error(`the Peer kept from ${kept.from} took other work meanwhile`);
    const entry = ledger.tasks[task.id];
    if (entry) Object.assign(entry, { peer, updatedAt: Date.now() });
    ledger.agents[peer] = { ...ledger.agents[peer], id: peer, role: how.role, lane: lane.id, task: task.id };
  });
}

/** What the watch saw of a kept Peer was about the task it leaves: closed, so a finding on the next one opens its own. */
function closeKept(desk: DeskServices, project: Project, peer: string): void {
  try {
    closeIncidentsOf(desk, project, peer);
  } catch (error) {
    // Best effort: an incident book that cannot be read must not undo a start already bound.
    desk.log(project, `the incidents of ${peer} could not be closed: ${errorText(error)}`);
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
  if (task.takeBase && !task.tookBase) await takeBase(ledgers, project, lane, task, copy.path);
  return copy;
}

/** Merges base into the task's branch once, conflicts left for its Peer to settle and commit. */
async function takeBase(
  ledgers: DeskServices["ledgers"],
  project: Project,
  lane: Lane,
  task: Task,
  cwd: string,
): Promise<void> {
  const sha = await headSha(cwd, lane.base);
  if (!sha) throw new Error(`${lane.base} could not be read to merge into ${task.branch}`);
  const merged = await mergeBranch(cwd, sha, `Bring ${lane.base} into ${task.branch}`, {
    leave: true,
    timeout: gitTimeout(project),
  });
  if (!merged.ok && merged.conflicts.length === 0)
    throw new Error(`${lane.base} does not merge into ${task.branch}: ${merged.message}`);
  const conflicts = merged.ok ? [] : merged.conflicts;
  ledgers.setTask(project, task.id, (entry) => Object.assign(entry, { tookBase: { sha, conflicts } }));
}

/** A Peer that did not start leaves its task waiting, and the copy it was given as it was. */
async function putBack(
  { ledgers, slots }: Pick<DeskServices, "ledgers" | "slots">,
  project: Project,
  lane: Lane,
  task: Task,
): Promise<void> {
  const parallel = task.mode === "parallel";
  const { slot: taken, tookBase } = loadLedger(project.state).tasks[task.id] ?? {};
  // The merge this start left goes, so the next start makes it again.
  if (tookBase && tookBase.conflicts.length > 0 && lane.worktree) await git(lane.worktree, ["merge", "--abort"]);
  ledgers.setTask(project, task.id, (entry) => {
    TASK.move(entry, "wait");
    delete entry.tookBase;
    if (parallel) {
      delete entry.slot;
      delete entry.worktree;
    }
  });
  if (parallel) await slots.release(project, taken, task.branch, lane.branch);
  else if (!(await backOnLane(lane))) await dropMerged(lane.worktree!, task.branch!, lane.branch);
}
