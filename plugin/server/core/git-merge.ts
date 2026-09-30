import { git, headSha } from "./git.ts";

/** What the desk commits is made as paseo-crew and unsigned: the Human's name and signer are for their own commits. */
export const AS_DESK = [
  "-c",
  "user.name=paseo-crew",
  "-c",
  "user.email=paseo-crew@localhost",
  "-c",
  "commit.gpgSign=false",
];

type MergeResult = { ok: true; before: string; after: string } | { ok: false; conflicts: string[]; message: string };

/**
 * `leave` keeps a merge stopped on conflicts in place for a seat to settle and commit; anything else that stops it is
 * undone. The Human's rerere would settle conflicts unseen, and their signer can wait on them: neither applies.
 */
export async function mergeBranch(
  cwd: string,
  branch: string,
  message: string,
  { leave = false, timeout }: { leave?: boolean; timeout: number },
): Promise<MergeResult> {
  const before = await headSha(cwd);
  if (!before) return { ok: false, conflicts: [], message: "the lane working copy has no HEAD" };
  const run = await git(
    cwd,
    [...AS_DESK, "-c", "rerere.enabled=false", "merge", "--no-ff", "-m", message, branch],
    timeout,
  );
  if (run.code === 0) return { ok: true, before, after: (await headSha(cwd)) ?? before };
  const unmerged = await git(cwd, ["diff", "--name-only", "--diff-filter=U"]);
  const conflicts = unmerged.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!leave || conflicts.length === 0) await git(cwd, ["merge", "--abort"]);
  return { ok: false, conflicts, message: (run.stdout + run.stderr).trim().slice(-1500) };
}

/** The tree merging `ours` and `theirs` would make, conflicts written in with their markers; undefined when git cannot make it. */
export async function mergeTree(cwd: string, ours: string, theirs: string): Promise<string | undefined> {
  const run = await git(cwd, ["merge-tree", "--write-tree", "--no-messages", ours, theirs]);
  // 1 is a merge with conflicts, whose tree git still writes.
  return run.code === 0 || run.code === 1 ? run.stdout.split("\n")[0]?.trim() || undefined : undefined;
}

/** `into` as the merge that brought `branch` in, if it is one: a merge a stop cut off after git made it. */
export async function mergeOf(
  cwd: string,
  into: string,
  branch: string,
): Promise<{ before: string; after: string } | undefined> {
  const sha = async (ref: string) => {
    const run = await git(cwd, ["rev-parse", "--verify", "-q", ref]);
    return run.code === 0 ? run.stdout.trim() : undefined;
  };
  const [after, before, merged, tip] = await Promise.all([into, `${into}^1`, `${into}^2`, branch].map(sha));
  return after && before && merged && merged === tip ? { before, after } : undefined;
}
