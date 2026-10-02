import { mergeBranch } from "../../core/git-merge.ts";
import { currentBranch, isAncestor } from "../../core/git.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, tasksOf } from "../../domain/ledger.ts";
import { type Project, gitTimeout } from "../project/project.ts";
import type { Roster } from "../seats/roster.ts";
import { midTurnAmong } from "../seats/writing.ts";

/** What stops a base merge; `writers` are the seats mid-turn in the lane's copy, `conflicts` the files base conflicts in. */
type Stop = { why: string; then: string; writers?: string[]; conflicts?: string[] };

/** Merges base into the lane in its own copy, never under a seat mid-turn there other than `caller`; conflicts leave nothing behind. */
export async function bringBaseIn(
  roster: Roster,
  project: Project,
  ledger: Ledger,
  lane: Lane,
  caller?: string,
): Promise<Stop | undefined> {
  const copy = lane.worktree;
  if (!copy)
    return { why: `it has no working copy on record to merge ${lane.base} into`, then: "Drop it with drop_lane." };
  const blocked = await baseMergeBlocked(roster, ledger, lane, copy, caller);
  if (blocked) return blocked === "current" ? undefined : blocked;
  // Never left mid-merge: every task in the copy starts by switching branch, which git refuses then.
  const merged = await mergeBranch(copy, lane.base, `Bring ${lane.base} into ${lane.branch}`, {
    timeout: gitTimeout(project),
  });
  if (merged.ok) return undefined;
  if (merged.conflicts.length === 0)
    return {
      why: `${lane.base} has moved on and does not merge into ${lane.branch}: ${merged.message}`,
      then: "Nothing was changed. Message its Lead, or drop_lane it.",
    };
  return {
    why: `${lane.base} has moved on and conflicts with ${lane.branch} in ${merged.conflicts.join(", ")}`,
    then: "",
    conflicts: merged.conflicts,
  };
}

/** Why base cannot be merged into the lane's copy now, or "current" when it holds base already; an unseen seat counts as writing. */
async function baseMergeBlocked(
  roster: Roster,
  ledger: Ledger,
  lane: Lane,
  copy: string,
  caller: string | undefined,
): Promise<Stop | "current" | undefined> {
  // A task's branch there is work the lane has not taken: neither base nor the gate would meet the lane's own tree.
  const on = await currentBranch(copy);
  const holding = tasksOf(ledger, lane.id).find((task) => task.kind === "code" && task.branch === on);
  if (holding)
    return {
      why: `its working copy is on ${on}, ${holding.id}'s branch, not ${lane.branch}`,
      then: `Land it once ${holding.id} is merged or cut.`,
    };
  if (await isAncestor(copy, lane.base, lane.branch)) return "current";
  // Readers count too: a merge changes the files under whoever is reading them.
  const inCopy = tasksOf(ledger, lane.id).filter((task) => task.mode !== "parallel");
  const seats = [lane.lead, ...inCopy.map((task) => task.peer)].filter((seat) => seat !== caller);
  const busy = await midTurnAmong(roster, seats);
  if (busy.length === 0) return undefined;
  return {
    why: `${lane.base} has moved on, so landing it starts with merging ${lane.base} into ${lane.branch} in its copy, and a seat is mid-turn there`,
    then: "CAN LAND comes as mail when that turn ends; land_lane it again then, or drop_lane it.",
    writers: busy,
  };
}
