import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Run = { code: number; stdout: string; stderr: string };

export function git(cwd: string, args: string[], timeout = 60_000): Promise<Run> {
  return new Promise((resolve) => {
    // core.quotePath=false: otherwise non-ASCII paths come back quoted and octal-escaped and match no path a write set or hold names.
    execFile(
      "git",
      ["-C", cwd, "-c", "core.quotePath=false", ...args],
      { timeout, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error
          ? typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : 1
          : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
  const run = await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return run.code === 0 ? run.stdout.trim() : undefined;
}

export async function headSha(cwd: string, ref = "HEAD"): Promise<string | undefined> {
  const run = await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return run.code === 0 ? run.stdout.trim() : undefined;
}

/** Three states because a failed `status` (dir gone, not a repo, timeout, no git) must not read as dirty. */
type Cleanliness = "clean" | "dirty" | "unknown";

async function cleanliness(cwd: string, args: string[]): Promise<Cleanliness> {
  const run = await git(cwd, args);
  if (run.code !== 0) return "unknown";
  return run.stdout.trim() === "" ? "clean" : "dirty";
}

/** Tracked files only; untracked files do not count. */
export function cleanState(cwd: string): Promise<Cleanliness> {
  return cleanliness(cwd, ["status", "--porcelain", "--untracked-files=no"]);
}

/** Uncommitted and untracked paths, or undefined when git cannot say; `besides` excuses a change that is nobody's work. */
export async function uncommittedPaths(
  cwd: string,
  besides: (path: string) => Promise<boolean> = async () => false,
): Promise<string[] | undefined> {
  const run = await git(cwd, ["status", "--porcelain"]);
  if (run.code !== 0) return undefined;
  const found: string[] = [];
  for (const line of run.stdout.split("\n").filter(Boolean))
    if (!(await besides(line.slice(3)))) found.push(line.slice(3));
  return found;
}

/** Nothing uncommitted or untracked, as a lane takeover requires. */
export async function pristineState(cwd: string, besides?: (path: string) => Promise<boolean>): Promise<Cleanliness> {
  const paths = await uncommittedPaths(cwd, besides);
  return paths === undefined ? "unknown" : paths.length > 0 ? "dirty" : "clean";
}

export async function trackedFiles(cwd: string): Promise<string[]> {
  const run = await git(cwd, ["ls-files", "-z"]);
  return run.code === 0 ? run.stdout.split("\0").filter(Boolean) : [];
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return (await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
}

/** Deletes `branch` once everything on it is in `into`; false when it holds commits `into` lacks, or git could not tell, and is kept. */
export async function dropMerged(cwd: string, branch: string, into: string): Promise<boolean> {
  return (await contains(cwd, into, branch)) === true && (await git(cwd, ["branch", "-D", branch])).code === 0;
}

/** Puts `cwd` on `branch`, made from `start` when it is not there yet; git's reason when it cannot. `discard` drops work uncommitted there. */
export async function switchTo(
  cwd: string,
  branch: string,
  start: string,
  discard = false,
): Promise<string | undefined> {
  const exists = await branchExists(cwd, branch);
  const run = await git(cwd, [
    "switch",
    ...(discard ? ["--discard-changes"] : []),
    ...(exists ? [branch] : ["-c", branch, start]),
  ]);
  if (run.code === 0 && discard) await git(cwd, ["clean", "-fd"]);
  return run.code === 0 ? undefined : run.stderr.trim() || `git switch exited ${run.code}`;
}

/** Undefined when git could not answer: zero read as "no commits beyond the lane branch", which is a claim. */
export async function commitsAhead(cwd: string, base: string, branch: string): Promise<number | undefined> {
  const run = await git(cwd, ["rev-list", "--count", `${base}..${branch}`]);
  if (run.code !== 0) return undefined;
  const count = Number(run.stdout.trim());
  return Number.isInteger(count) ? count : undefined;
}

/** Whether everything on `branch` is already in `into` — undefined when git could not say, because a branch is about to be deleted on this answer. */
export async function contains(cwd: string, into: string, branch: string): Promise<boolean | undefined> {
  if (!(await branchExists(cwd, branch))) return undefined;
  const run = await git(cwd, ["rev-list", "--count", `${into}..${branch}`]);
  const count = Number(run.stdout.trim());
  return run.code === 0 && Number.isInteger(count) ? count === 0 : undefined;
}

export async function addWorktree(
  root: string,
  path: string,
  branch: string,
  base: string,
): Promise<{ ok: boolean; message: string }> {
  if (!(await branchExists(root, base))) return { ok: false, message: `the base branch ${base} does not exist` };
  if (await branchExists(root, branch)) return { ok: false, message: `the branch ${branch} already exists` };
  const run = await git(root, ["worktree", "add", "-b", branch, path, base], 120_000);
  // git can fail with no output at all (timeout, missing binary); never report an empty reason.
  return {
    ok: run.code === 0,
    message: (run.stderr || run.stdout).trim() || `git worktree add exited ${run.code} with nothing to say`,
  };
}

export async function removeWorktree(root: string, path: string | undefined): Promise<void> {
  if (!path) return;
  await git(root, ["worktree", "remove", "--force", path], 60_000);
  await git(root, ["worktree", "prune"], 30_000);
}

type MergeResult = { ok: true; before: string; after: string } | { ok: false; conflicts: string[]; message: string };

/**
 * `leave` keeps a merge stopped on conflicts in place for a seat to settle and commit, since no seat may run git merge; anything
 * else that stops it is undone. The Human's rerere would settle conflicts unseen, and their signer can wait on them: neither applies.
 */
export async function mergeBranch(cwd: string, branch: string, message: string, leave = false): Promise<MergeResult> {
  const before = await headSha(cwd);
  if (!before) return { ok: false, conflicts: [], message: "the lane working copy has no HEAD" };
  const own = [
    "-c",
    "user.name=seatworks",
    "-c",
    "user.email=seatworks@localhost",
    "-c",
    "rerere.enabled=false",
    "-c",
    "commit.gpgSign=false",
  ];
  const run = await git(cwd, [...own, "merge", "--no-ff", "-m", message, branch], 120_000);
  if (run.code === 0) return { ok: true, before, after: (await headSha(cwd)) ?? before };
  const unmerged = await git(cwd, ["diff", "--name-only", "--diff-filter=U"]);
  const conflicts = unmerged.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!leave || conflicts.length === 0) await git(cwd, ["merge", "--abort"]);
  return { ok: false, conflicts, message: (run.stdout + run.stderr).trim().slice(-1500) };
}

/** A merge begun in the copy and neither committed nor undone: no seat may begin one, so it is one the desk left for a seat to settle. */
export async function mergeUnderWay(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).code === 0;
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

/** What is uncommitted in `cwd`, named: a stray message file reads as unfinished work otherwise. */
export async function uncommittedIn(cwd: string): Promise<string> {
  const run = await git(cwd, ["status", "--porcelain"]);
  const lines = run.stdout.split("\n").filter((line) => line.trim());
  const shown = lines
    .slice(0, 6)
    .map((line) => line.trim())
    .join(", ");
  return lines.length > 6
    ? `${shown} and ${lines.length - 6} more`
    : shown || "something git reports but does not name";
}

/** Where `branch` left `base`: what a lane changed is read from here, however far `base` has moved since. */
export async function mergeBase(cwd: string, base: string, branch: string): Promise<string | undefined> {
  const run = await git(cwd, ["merge-base", base, branch]);
  return run.code === 0 ? run.stdout.trim() || undefined : undefined;
}

/** Whether `base` is already contained in `branch`, so landing is a fast-forward rather than a merge. */
export async function isAncestor(root: string, base: string, branch: string): Promise<boolean> {
  return (await git(root, ["merge-base", "--is-ancestor", base, branch])).code === 0;
}

export type LandAs = "squash" | "merge" | "ff";

export const LAND_AS: LandAs[] = ["squash", "merge", "ff"];

/** Where a landed lane's own commits stay reachable once its branch is gone: squashed, base never carries them. */
export const landedRef = (lane: string) => `refs/seatworks/lanes/${lane}`;

export function gitCommonDir(cwd: string): string | undefined {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export function excludeFromGit(repo: string, pattern: string): void {
  const common = gitCommonDir(repo);
  if (!common) return;
  try {
    const file = join(common, "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf-8") : "";
    if (current.split(/\r?\n/).includes(pattern)) return;
    mkdirSync(join(common, "info"), { recursive: true });
    appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}${pattern}\n`);
  } catch {
    // Left out of the exclude list, the path shows as untracked: noise, never lost work.
  }
}
