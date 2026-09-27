import { type LandAs, cleanState, currentBranch, git, headSha, isAncestor } from "./git.ts";

type LandResult = { landed: boolean; how: string };

/** Why a branch was not moved: work uncommitted or unreadable in the checkout `where` it is, a move from what was read, or git refusing the fast-forward. */
type Unmoved = { why: "dirty" | "unknown" | "moved" | "refused"; where?: string; detail?: string };

/** The working copy that has `branch` checked out: `cwd` itself, another worktree of its repository, or none. */
async function checkoutOf(cwd: string, branch: string): Promise<string | undefined> {
  if ((await currentBranch(cwd)) === branch) return cwd;
  let path: string | undefined;
  for (const line of (await git(cwd, ["worktree", "list", "--porcelain"])).stdout.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.trim() === `branch refs/heads/${branch}`) return path;
  }
  return undefined;
}

/**
 * Moves `branch` to `tip` only from `from`, the commit it was read as: a fast-forward in the copy that has it checked out,
 * wherever that is, otherwise a ref update git refuses once `branch` has moved, so nothing written in between is written over.
 */
export async function advance(cwd: string, branch: string, from: string, tip: string): Promise<Unmoved | undefined> {
  const where = await checkoutOf(cwd, branch);
  if (!where)
    return (await git(cwd, ["update-ref", `refs/heads/${branch}`, tip, from])).code === 0
      ? undefined
      : { why: "moved" };
  const state = await cleanState(where);
  if (state !== "clean") return { why: state, where };
  if ((await headSha(where, branch)) !== from) return { why: "moved" };
  const run = await git(where, ["merge", "--ff-only", tip]);
  return run.code === 0 ? undefined : { why: "refused", where, detail: run.stderr.trim() || "fast-forward failed" };
}

/** A merge of `branch` onto `onto` whose tree is `branch`'s own, made without checking anything out: `branch` already contains `onto`. */
export async function mergeCommit(
  cwd: string,
  onto: string,
  branch: string,
  message: string,
): Promise<string | undefined> {
  const tip = await headSha(cwd, branch);
  const own = ["-c", "user.name=seatworks", "-c", "user.email=seatworks@localhost", "-c", "commit.gpgSign=false"];
  const made = tip
    ? await git(cwd, [...own, "commit-tree", `${tip}^{tree}`, "-p", onto, "-p", tip, "-m", message])
    : undefined;
  return made?.code === 0 ? made.stdout.trim() : undefined;
}

/** Why a landing did not move base, as whoever lands the lane reads it, naming the copy that stopped it. */
function unlanded(base: string, root: string, stopped: Unmoved): string {
  const copy = stopped.where === root ? "the main working copy" : `the working copy at ${stopped.where}`;
  if (stopped.why === "dirty")
    return stopped.where === root
      ? `the main working copy on ${base} has uncommitted changes`
      : `${copy}, which has ${base} checked out, has uncommitted changes`;
  if (stopped.why === "unknown") return `git could not read ${copy}, which has ${base} checked out`;
  return stopped.why === "moved"
    ? `${base} moved while this lane was landing; land it again`
    : `${copy} would not fast-forward ${base}: ${stopped.detail ?? "fast-forward failed"}`;
}

/**
 * Lands `tested`, the head of `branch` its gate saw, on `base` as one commit, a merge commit or a fast-forward, made without
 * checking anything out. A lane that moved since its gate lands nothing: what would land is not what was tested.
 */
export async function landLane(
  root: string,
  base: string,
  branch: string,
  tested: string,
  how: { as: LandAs; message: string; keep: string },
): Promise<LandResult> {
  const from = await headSha(root, base);
  if (!from) return { landed: false, how: `git could not read ${base}` };
  if ((await headSha(root, branch)) !== tested)
    return { landed: false, how: `${branch} moved after its gate ran, so what would land is not what was tested` };
  if (!(await isAncestor(root, from, tested)))
    return {
      landed: false,
      how: `${branch} does not contain ${base}, so landing it would be a merge nobody has gated`,
    };
  // Undefined when the lane changes nothing on base: there is nothing to commit and base stays where it is.
  let tip: string | undefined = tested;
  if (how.as !== "ff") {
    const trees = await git(root, ["rev-parse", `${from}^{tree}`, `${tested}^{tree}`]);
    const [was, now] = trees.stdout.trim().split("\n");
    if (trees.code === 0 && was === now) tip = undefined;
    else {
      const parents = how.as === "merge" ? [from, tested] : [from];
      const made = await git(root, [
        "commit-tree",
        `${tested}^{tree}`,
        ...parents.flatMap((parent) => ["-p", parent]),
        "-m",
        how.message,
      ]);
      if (made.code !== 0) return { landed: false, how: made.stderr.trim() || "git could not make the commit to land" };
      tip = made.stdout.trim();
    }
  }
  const stopped = tip ? await advance(root, base, from, tip) : undefined;
  if (stopped) return { landed: false, how: unlanded(base, root, stopped) };
  // Should this fail, the branch is kept rather than lost: dropping it checks it against this ref.
  await git(root, ["update-ref", how.keep, tested]);
  if (!tip) return { landed: true, how: `${branch} changes nothing on ${base}, so nothing was committed` };
  return {
    landed: true,
    how:
      how.as === "squash"
        ? `squashed ${branch} into one commit on ${base}, its own commits kept at ${how.keep}`
        : how.as === "merge"
          ? `merged ${branch} into ${base}`
          : `fast-forwarded ${base} to ${branch}`,
  };
}
