import { currentBranch, landedRef } from "../core/git.ts";
import type { Lane, Task } from "./ledger.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";
import { leaveCopy } from "./sync.ts";

type Stowing = { land: boolean; kept: boolean; writers: string[] };

/**
 * Takes a closing lane's copy where the lane leaves it, once `writers` are out of it: a task still in it left it on that task's
 * branch, which the copy comes back from and which goes once the lane has all of it. Says what it kept, and where git left the copy instead.
 */
export async function stowCopy(
  desk: DeskServices,
  project: Project,
  lane: Lane,
  retired: Task[],
  how: Stowing,
): Promise<{ kept: string[]; note: string }> {
  const on = lane.worktree ? await currentBranch(lane.worktree) : undefined;
  const holder = retired.find((task) => task.kind === "code" && task.mode !== "parallel" && task.branch === on);
  const off = holder
    ? { branch: holder.branch!, dropBranch: holder.branch, into: lane.branch }
    : { branch: lane.branch };
  const kept: string[] = [];
  // A branch carried on is the Human's, back on it from a task's, and a copy of the lane's own stays with a kept Lead, off a task's branch if nobody is in it.
  if (lane.onBranch && holder)
    await desk.teardowns.putAway({ project, restore: lane.branch, lane: lane.id, ...off }, how.writers);
  const back = lane.slot && how.kept && holder && how.writers.length === 0 ? await leaveCopy(lane, holder) : undefined;
  if (back?.kept) kept.push(back.kept);
  if (!lane.onBranch && (!lane.slot || !how.kept)) {
    const drop = how.land ? { dropBranch: lane.branch, into: landedRef(lane.id) } : {};
    const branch = await desk.teardowns.putAway(
      { project, slot: lane.slot, restore: lane.base, lane: lane.id, ...off, ...drop },
      how.writers,
    );
    if (branch) kept.push(branch);
  }
  const now =
    lane.worktree && (lane.slot ? how.kept : how.writers.length === 0) ? await currentBranch(lane.worktree) : undefined;
  const stuck = now && now !== (lane.slot || lane.onBranch ? lane.branch : lane.base) ? now : undefined;
  return { kept, note: copyNote(lane, how, Boolean(holder), stuck) };
}

/** Where the lane's copy stands once it closes: on a carried-on branch, kept with its Lead, going away, or the Human's going back; `stuck`, where git left it instead. */
function copyNote(lane: Lane, { kept, writers }: Stowing, held: boolean, stuck?: string): string {
  if (lane.onBranch && !held) return `The project's own copy stays on ${lane.branch}.`;
  if (lane.slot && kept)
    return `Its working copy ${lane.slot} stays with its Lead${stuck ? `, still on ${stuck}` : ""}.`;
  const to = lane.onBranch ? lane.branch : lane.base;
  if (stuck)
    return `The project's own copy is still on ${stuck}: git would not take it to ${to} as it stands, and each round tries again.`;
  const where = lane.slot ? "Its working copy is put away" : `The project's own copy goes back to ${to}`;
  return writers.length > 0
    ? `${where} once ${writers.join(" and ")} finish the turn they are in.`
    : lane.slot
      ? "Its working copy is put away."
      : `The project's own copy is back on ${to}.`;
}
