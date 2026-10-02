import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { devNull } from "node:os";
import { join } from "node:path";

type Run = { code: number; stdout: string; stderr: string };

function spawnGit(args: string[], timeout: number): Promise<Run> {
  return new Promise((resolve) => {
    execFile("git", args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
      if (typeof error.code === "number")
        return resolve({ code: error.code, stdout: String(stdout), stderr: String(stderr) });
      // A git that never started or was killed says nothing itself: say why, or the reason reads empty.
      const why =
        typeof error.code !== "string" && error.killed
          ? `git was stopped at its time limit of ${timeout} ms`
          : error.message;
      resolve({ code: 1, stdout: String(stdout), stderr: [String(stderr).trim(), why].filter(Boolean).join("\n") });
    });
  });
}

/** Keys whose value git runs as a command. */
const RUNS_COMMAND =
  "^(filter\\..+\\.(clean|smudge|process)|merge\\..+\\.driver|diff\\..+\\.(textconv|command)|core\\.(sshcommand|gitproxy|askpass|editor)|sequence\\.editor|gpg\\.(.+\\.)?program)$";

/** Subcommands that only read or move refs and never run a filter or driver. */
const REFS_ONLY = new Set([
  "rev-parse",
  "symbolic-ref",
  "show-ref",
  "rev-list",
  "merge-base",
  "update-ref",
  "commit-tree",
  "for-each-ref",
  "check-ref-format",
  "ls-files",
  "branch",
  "remote",
  "config",
]);

function subcommandOf(args: string[]): string {
  for (let at = 0; at < args.length; at++) {
    if (args[at] === "-c") at++;
    else return args[at]!;
  }
  return "";
}

/** Desk git runs outside every seat's sandbox, so nothing a seat can plant in the shared repository runs with it; the Human's global config stands. */
async function unplanted(cwd: string, args: string[]): Promise<string[]> {
  const always = ["-c", `core.hooksPath=${devNull}`, "-c", "core.fsmonitor=false"];
  if (REFS_ONLY.has(subcommandOf(args))) return always;
  const listed = await spawnGit(
    ["-C", cwd, "config", "--show-scope", "--name-only", "--get-regexp", RUNS_COMMAND],
    30_000,
  );
  const planted = listed.stdout.split("\n").flatMap((line) => {
    const [scope, key] = line.split("\t");
    return key && (scope === "local" || scope === "worktree") ? ["-c", `${key}=`] : [];
  });
  return [...always, ...planted];
}

export async function git(cwd: string, args: string[], timeout = 60_000): Promise<Run> {
  // core.quotePath=false: otherwise non-ASCII paths come back quoted and octal-escaped and match no path a write set or hold names.
  return spawnGit(["-C", cwd, "-c", "core.quotePath=false", ...(await unplanted(cwd, args)), ...args], timeout);
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
  const run = await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return run.code === 0 ? run.stdout.trim() : undefined;
}

export async function treeOf(cwd: string, ref = "HEAD"): Promise<string | undefined> {
  const run = await git(cwd, ["rev-parse", "--verify", `${ref}^{tree}`]);
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

/** Uncommitted paths, untracked ones too unless `untracked` is false, or undefined when git cannot say; read NUL-separated, so a name is as it is and a rename is where it went. */
export async function uncommittedPaths(cwd: string, untracked = true): Promise<string[] | undefined> {
  const run = await git(cwd, ["status", "--porcelain", "-z", ...(untracked ? [] : ["--untracked-files=no"])]);
  if (run.code !== 0) return undefined;
  const entries = run.stdout.split("\0").filter(Boolean);
  const found: string[] = [];
  for (let at = 0; at < entries.length; at++) {
    found.push(entries[at]!.slice(3));
    // A rename or copy is followed by the path it came from, which is no change of its own.
    if (/^[RC]|^.[RC]/.test(entries[at]!)) at++;
  }
  return found;
}

/** Nothing uncommitted or untracked, as a lane takeover requires. */
export async function pristineState(cwd: string): Promise<Cleanliness> {
  const paths = await uncommittedPaths(cwd);
  return paths === undefined ? "unknown" : paths.length > 0 ? "dirty" : "clean";
}

/** The files git tracks in `cwd`, or undefined when git cannot say: an empty list would read as a copy holding nothing. */
export async function trackedFiles(cwd: string): Promise<string[] | undefined> {
  const run = await git(cwd, ["ls-files", "-z"]);
  return run.code === 0 ? run.stdout.split("\0").filter(Boolean) : undefined;
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return (await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
}

/** Deletes `branch` once everything on it is in `into`; false when it holds commits `into` lacks, or git could not tell, and is kept. */
export async function dropMerged(cwd: string, branch: string, into: string): Promise<boolean> {
  return (await contains(cwd, into, branch)) === true && (await git(cwd, ["branch", "-D", branch])).code === 0;
}

/** Puts `cwd` on `branch`, made from `start` if absent; git's reason when it cannot. `discard` drops tracked edits, `untracked` also untracked files. */
export async function switchTo(
  cwd: string,
  branch: string,
  start: string,
  discard = false,
  untracked = false,
): Promise<string | undefined> {
  const exists = await branchExists(cwd, branch);
  // git refuses to switch mid-merge even when discarding: a merge the desk left for a seat goes with the rest.
  if (discard && (await mergeUnderWay(cwd))) await git(cwd, ["merge", "--abort"]);
  const run = await git(cwd, [
    "switch",
    ...(discard ? ["--discard-changes"] : []),
    ...(exists ? [branch] : ["--no-track", "-c", branch, start]),
  ]);
  if (run.code === 0 && discard && untracked) await git(cwd, ["clean", "-fd"]);
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
  timeout: number,
): Promise<{ ok: boolean; message: string }> {
  if (!(await branchExists(root, base))) return { ok: false, message: `the base branch ${base} does not exist` };
  if (await branchExists(root, branch)) return { ok: false, message: `the branch ${branch} already exists` };
  const run = await git(root, ["worktree", "add", "--no-track", "-b", branch, path, base], timeout);
  // git can fail with no output at all (timeout, missing binary); never report an empty reason.
  return {
    ok: run.code === 0,
    message: (run.stderr || run.stdout).trim() || `git worktree add exited ${run.code} with nothing to say`,
  };
}

/** Keeps git's own commands, the Human's prune or remove among them, from taking a copy away under whoever works there. */
export async function lockWorktree(root: string, path: string, reason: string): Promise<void> {
  await git(root, ["worktree", "lock", "--reason", reason, path]);
}

export async function unlockWorktree(root: string, path: string): Promise<void> {
  await git(root, ["worktree", "unlock", path]);
}

export async function removeWorktree(root: string, path: string | undefined): Promise<void> {
  if (!path) return;
  // Twice forced, it goes locked or not: only a copy the desk made and holds nothing of anyone's gets here.
  await git(root, ["worktree", "remove", "--force", "--force", path], 60_000);
  await git(root, ["worktree", "prune"], 30_000);
}

/** A merge begun in the copy and neither committed nor undone: no seat may begin one, so it is one the desk left for a seat to settle. */
export async function mergeUnderWay(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).code === 0;
}

/** What is uncommitted in `cwd`, named: a stray message file reads as unfinished work otherwise. */
export async function uncommittedIn(cwd: string, untracked = true): Promise<string> {
  const run = await git(cwd, ["status", "--porcelain", ...(untracked ? [] : ["--untracked-files=no"])]);
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
export const landedRef = (lane: string) => `refs/crew/lanes/${lane}`;

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
