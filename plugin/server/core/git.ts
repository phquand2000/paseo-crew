import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { coverOf } from "./scope.ts";

type Run = { code: number; stdout: string; stderr: string };

export function git(cwd: string, args: string[], timeout = 60_000): Promise<Run> {
  return new Promise((resolve) => {
    // core.quotePath=false: otherwise non-ASCII paths come back quoted and octal-escaped and match no owned path.
    execFile("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
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
export async function uncommittedPaths(cwd: string, besides: (path: string) => Promise<boolean> = async () => false): Promise<string[] | undefined> {
  const run = await git(cwd, ["status", "--porcelain"]);
  if (run.code !== 0) return undefined;
  const found: string[] = [];
  for (const line of run.stdout.split("\n").filter(Boolean)) if (!(await besides(line.slice(3)))) found.push(line.slice(3));
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

export async function addWorktree(root: string, path: string, branch: string, base: string): Promise<{ ok: boolean; message: string }> {
  if (!(await branchExists(root, base))) return { ok: false, message: `the base branch ${base} does not exist` };
  if (await branchExists(root, branch)) return { ok: false, message: `the branch ${branch} already exists` };
  const run = await git(root, ["worktree", "add", "-b", branch, path, base], 120_000);
  // git can fail with no output at all (timeout, missing binary); never report an empty reason.
  return { ok: run.code === 0, message: (run.stderr || run.stdout).trim() || `git worktree add exited ${run.code} with nothing to say` };
}

export async function removeWorktree(root: string, path: string | undefined): Promise<void> {
  if (!path) return;
  await git(root, ["worktree", "remove", "--force", path], 60_000);
  await git(root, ["worktree", "prune"], 30_000);
}

type MergeResult = { ok: true; before: string; after: string } | { ok: false; conflicts: string[]; message: string };

/** `leave` keeps a merge stopped on conflicts in place for a seat to settle and commit, since no seat may run git merge; anything else that stops it is undone. */
export async function mergeBranch(cwd: string, branch: string, message: string, leave = false): Promise<MergeResult> {
  const before = await headSha(cwd);
  if (!before) return { ok: false, conflicts: [], message: "the lane working copy has no HEAD" };
  const run = await git(cwd, ["-c", "user.name=seatworks", "-c", "user.email=seatworks@localhost", "merge", "--no-ff", "-m", message, branch], 120_000);
  if (run.code === 0) return { ok: true, before, after: (await headSha(cwd)) ?? before };
  const unmerged = await git(cwd, ["diff", "--name-only", "--diff-filter=U"]);
  const conflicts = unmerged.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!leave || conflicts.length === 0) await git(cwd, ["merge", "--abort"]);
  return { ok: false, conflicts, message: (run.stdout + run.stderr).trim().slice(-1500) };
}

/** A merge begun in the copy and neither committed nor undone: no seat may begin one, so it is one the desk left for a seat to settle. */
export async function mergeUnderWay(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).code === 0;
}

/** HEAD as the merge that brought `branch` in, if it is one: a merge a stop cut off after git made it. */
export async function mergeOf(cwd: string, branch: string): Promise<{ before: string; after: string } | undefined> {
  const sha = async (ref: string) => {
    const run = await git(cwd, ["rev-parse", "--verify", "-q", ref]);
    return run.code === 0 ? run.stdout.trim() : undefined;
  };
  const [after, before, merged, tip] = await Promise.all(["HEAD", "HEAD^1", "HEAD^2", branch].map(sha));
  return after && before && merged && merged === tip ? { before, after } : undefined;
}

export async function resetHard(cwd: string, sha: string): Promise<boolean> {
  return (await git(cwd, ["reset", "--hard", sha])).code === 0;
}

export type Counts = { src: number; test: number; docs: number; files: string[] };

/** Which paths are tests and which are docs, as the ecosystem the kit holds names them. */
export type FileKinds = { test: RegExp; docs: RegExp };

export function kindOf(path: string, kinds: FileKinds): "src" | "test" | "docs" {
  if (kinds.test.test(path)) return "test";
  return kinds.docs.test(path) ? "docs" : "src";
}

/** Uses `-z` so a rename yields both real paths, not the `src/{old.ts => new.ts}` form that matches no owned path. */
/** Lines of an `uncounted` path are left out of the counts; the path is still listed. */
export function countNumstat(numstat: string, kinds: FileKinds, uncounted: (path: string) => boolean = () => false): Counts {
  const counts: Counts = { src: 0, test: 0, docs: 0, files: [] };
  const fields = numstat.split("\0");
  for (let index = 0; index < fields.length; index++) {
    const row = fields[index];
    if (!row?.trim()) continue;
    const [added, removed, inline] = row.split("\t");
    const lines = (Number(added) || 0) + (Number(removed) || 0);
    const paths: string[] = [];
    if (inline?.trim()) paths.push(inline.trim());
    else {
      // A rename or a copy: the two paths follow as their own fields.
      const from = fields[index + 1];
      const to = fields[index + 2];
      if (from) paths.push(from);
      if (to) paths.push(to);
      index += 2;
    }
    for (const path of paths) {
      if (!uncounted(path)) counts[kindOf(path, kinds)] += lines;
      counts.files.push(path);
    }
  }
  return counts;
}

/** Undefined when git could not answer: zeroed counts read as "nothing changed", which is a claim. */
export async function diffCounts(cwd: string, from: string, to: string, kinds: FileKinds, uncounted?: (path: string) => boolean): Promise<Counts | undefined> {
  const run = await git(cwd, ["diff", "-z", "--numstat", `${from}..${to}`]);
  return run.code === 0 ? countNumstat(run.stdout, kinds, uncounted) : undefined;
}

/** The files changed across `range`, as git diff reads it, or undefined when git cannot say. */
export async function changedFiles(cwd: string, range: string): Promise<string[] | undefined> {
  const run = await git(cwd, ["diff", "-z", "--name-only", range]);
  return run.code === 0 ? run.stdout.split("\0").filter(Boolean) : undefined;
}

/** Every path the commits on a copy's first-parent line touched from `from` to `to`, a rename's both ends apart; merges left out. */
async function ownPaths(cwd: string, from: string, to: string): Promise<Set<string> | undefined> {
  const run = await git(cwd, ["log", "-z", "--first-parent", "--no-merges", "--no-renames", "--name-only", "--format=", `${from}..${to}`]);
  return run.code === 0 ? new Set(run.stdout.split("\0").filter(Boolean)) : undefined;
}

/**
 * The files a copy's own writer changed from `from` to `to`, as git diff reads them, leaving out what merges brought in: the desk
 * merges with --no-ff and no seat may merge, so the copy's first-parent line is its writer's own work. Undefined when git cannot say.
 */
export async function ownChangedFiles(cwd: string, from: string, to = "HEAD"): Promise<string[] | undefined> {
  const [net, own] = await Promise.all([changedFiles(cwd, `${from}..${to}`), ownPaths(cwd, from, to)]);
  return net && own && net.filter((path) => own.has(path));
}

/** What `diffCounts` says of a copy's own writer's work since `from`: the lines and files merges brought in are left out. */
export async function ownCounts(cwd: string, from: string, kinds: FileKinds): Promise<Counts | undefined> {
  const own = await ownPaths(cwd, from, "HEAD");
  const counts = own && (await diffCounts(cwd, from, "HEAD", kinds, (path) => !own.has(path)));
  return counts && { ...counts, files: counts.files.filter((path) => own!.has(path)) };
}

/** What is uncommitted in `cwd`, named: a stray message file reads as unfinished work otherwise. */
export async function uncommittedIn(cwd: string): Promise<string> {
  const run = await git(cwd, ["status", "--porcelain"]);
  const lines = run.stdout.split("\n").filter((line) => line.trim());
  const shown = lines.slice(0, 6).map((line) => line.trim()).join(", ");
  return lines.length > 6 ? `${shown} and ${lines.length - 6} more` : shown || "something git reports but does not name";
}

/** Whether the desk merged anything into the copy's line between `from` and `to`: a diff across them then shows others' work too. */
export async function mergesIn(cwd: string, from: string, to: string): Promise<boolean> {
  const run = await git(cwd, ["rev-list", "--first-parent", "--merges", "--count", `${from}..${to}`]);
  return run.code === 0 && Number(run.stdout.trim()) > 0;
}

export function outsideOwned(files: string[], owned: string[]): string[] {
  if (owned.length === 0) return [];
  const rules = owned.map(coverOf);
  return files.filter((file) => !rules.some((rule) => rule.test(file)));
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
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
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
  } catch {}
}
