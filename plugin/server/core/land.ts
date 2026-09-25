import { type LandAs, cleanState, currentBranch, git, headSha, isAncestor } from "./git.ts";

type LandResult = { landed: boolean; how: string };

/**
 * Moves `base` to `tip` only from `from`, the commit it was read as: a fast-forward where the project's own copy has it
 * checked out, otherwise a ref update git refuses once `base` has moved, so no landing in between is written over.
 */
export async function advanceBase(root: string, base: string, from: string, tip: string): Promise<LandResult> {
  const moved = { landed: false, how: `${base} moved while this lane was landing; land it again` };
  if ((await currentBranch(root)) === base) {
    const state = await cleanState(root);
    if (state === "dirty") return { landed: false, how: `the main working copy on ${base} has uncommitted changes` };
    if (state === "unknown") return { landed: false, how: `git could not read the main working copy at ${root}` };
    if ((await headSha(root, base)) !== from) return moved;
    const run = await git(root, ["merge", "--ff-only", tip]);
    return run.code === 0 ? { landed: true, how: "" } : { landed: false, how: run.stderr.trim() || "fast-forward failed" };
  }
  const used = await git(root, ["worktree", "list", "--porcelain"]);
  if (used.stdout.split("\n").some((line) => line.trim() === `branch refs/heads/${base}`)) return { landed: false, how: `${base} is checked out in another working copy` };
  return (await git(root, ["update-ref", `refs/heads/${base}`, tip, from])).code === 0 ? { landed: true, how: "" } : moved;
}

/**
 * Lands `tested`, the head of `branch` its gate saw, on `base` as one commit, a merge commit or a fast-forward, made without
 * checking anything out. A lane that moved since its gate lands nothing: what would land is not what was tested.
 */
export async function landLane(root: string, base: string, branch: string, tested: string, how: { as: LandAs; message: string; keep: string }): Promise<LandResult> {
  const from = await headSha(root, base);
  if (!from) return { landed: false, how: `git could not read ${base}` };
  if ((await headSha(root, branch)) !== tested) return { landed: false, how: `${branch} moved after its gate ran, so what would land is not what was tested` };
  if (!(await isAncestor(root, from, tested))) return { landed: false, how: `${branch} does not contain ${base}, so landing it would be a merge nobody has gated` };
  // Undefined when the lane changes nothing on base: there is nothing to commit and base stays where it is.
  let tip: string | undefined = tested;
  if (how.as !== "ff") {
    const trees = await git(root, ["rev-parse", `${from}^{tree}`, `${tested}^{tree}`]);
    const [was, now] = trees.stdout.trim().split("\n");
    if (trees.code === 0 && was === now) tip = undefined;
    else {
      const parents = how.as === "merge" ? [from, tested] : [from];
      const made = await git(root, ["commit-tree", `${tested}^{tree}`, ...parents.flatMap((parent) => ["-p", parent]), "-m", how.message]);
      if (made.code !== 0) return { landed: false, how: made.stderr.trim() || "git could not make the commit to land" };
      tip = made.stdout.trim();
    }
  }
  if (tip) {
    const moved = await advanceBase(root, base, from, tip);
    if (!moved.landed) return moved;
  }
  // Should this fail, the branch is kept rather than lost: dropping it checks it against this ref.
  await git(root, ["update-ref", how.keep, tested]);
  if (!tip) return { landed: true, how: `${branch} changes nothing on ${base}, so nothing was committed` };
  return { landed: true, how: how.as === "squash" ? `squashed ${branch} into one commit on ${base}, its own commits kept at ${how.keep}` : how.as === "merge" ? `merged ${branch} into ${base}` : `fast-forwarded ${base} to ${branch}` };
}
