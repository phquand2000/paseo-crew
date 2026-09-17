import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Run = { code: number; stdout: string; stderr: string };

export function git(cwd: string, args: string[], timeout = 60_000): Promise<Run> {
  return new Promise((resolve) => {
    // core.quotePath=false because every path this module reads back is then matched against the
    // owned paths and shown to a Lead. Left on, git wraps any path with a character outside ASCII
    // in quotes and octal-escapes it, so a real file lands as gibberish that matches nothing.
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

export async function isClean(cwd: string): Promise<boolean> {
  const run = await git(cwd, ["status", "--porcelain", "--untracked-files=no"]);
  return run.code === 0 && run.stdout.trim() === "";
}

export async function isPristine(cwd: string): Promise<boolean> {
  const run = await git(cwd, ["status", "--porcelain"]);
  return run.code === 0 && run.stdout.trim() === "";
}

export async function trackedFiles(cwd: string): Promise<string[]> {
  const run = await git(cwd, ["ls-files", "-z"]);
  return run.code === 0 ? run.stdout.split("\0").filter(Boolean) : [];
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return (await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
}

export async function commitsAhead(cwd: string, base: string, branch: string): Promise<number> {
  const run = await git(cwd, ["rev-list", "--count", `${base}..${branch}`]);
  return run.code === 0 ? Number(run.stdout.trim()) || 0 : 0;
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
  return { ok: run.code === 0, message: (run.stderr || run.stdout).trim() };
}

export async function removeWorktree(root: string, path: string | undefined): Promise<void> {
  if (!path) return;
  await git(root, ["worktree", "remove", "--force", path], 60_000);
  await git(root, ["worktree", "prune"], 30_000);
}

export type MergeResult = { ok: true; before: string; after: string } | { ok: false; conflicts: string[]; message: string };

export async function mergeBranch(cwd: string, branch: string, message: string): Promise<MergeResult> {
  const before = await headSha(cwd);
  if (!before) return { ok: false, conflicts: [], message: "the lane working copy has no HEAD" };
  const run = await git(cwd, ["-c", "user.name=seatworks", "-c", "user.email=seatworks@localhost", "merge", "--no-ff", "-m", message, branch], 120_000);
  if (run.code === 0) return { ok: true, before, after: (await headSha(cwd)) ?? before };
  const unmerged = await git(cwd, ["diff", "--name-only", "--diff-filter=U"]);
  const conflicts = unmerged.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  await git(cwd, ["merge", "--abort"]);
  return { ok: false, conflicts, message: (run.stdout + run.stderr).trim().slice(-1500) };
}

export async function resetHard(cwd: string, sha: string): Promise<boolean> {
  return (await git(cwd, ["reset", "--hard", sha])).code === 0;
}

export type Counts = { src: number; test: number; docs: number; files: string[] };

export function kindOf(path: string): "src" | "test" | "docs" {
  if (/(^|\/)(tests?|__tests__|spec|specs)\//i.test(path) || /\.(test|spec)\.[a-z0-9]+$/i.test(path) || /(Test|Tests|IT)\.(java|kt|scala|cs)$/.test(path) || /_test\.(go|py|rb)$/.test(path) || /(^|\/)test_[^/]+\.py$/.test(path)) {
    return "test";
  }
  if (/\.(md|mdx|txt|rst|adoc)$/i.test(path) || /(^|\/)docs?\//i.test(path)) return "docs";
  return "src";
}

export function countNumstat(numstat: string): Counts {
  const counts: Counts = { src: 0, test: 0, docs: 0, files: [] };
  for (const line of numstat.split("\n")) {
    const [added, removed, ...rest] = line.split("\t");
    const path = rest.join("\t").trim();
    if (!path) continue;
    const lines = (Number(added) || 0) + (Number(removed) || 0);
    counts[kindOf(path)] += lines;
    counts.files.push(path);
  }
  return counts;
}

export async function diffCounts(cwd: string, from: string, to: string): Promise<Counts> {
  const run = await git(cwd, ["diff", "--numstat", `${from}..${to}`]);
  return countNumstat(run.stdout);
}

export function outsideOwned(files: string[], owned: string[]): string[] {
  if (owned.length === 0) return [];
  const prefixes = owned.map((path) => path.replace(/^\.\//, "").replace(/\*+.*$/, ""));
  return files.filter((file) => !prefixes.some((prefix) => file === prefix || file.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || (prefix !== "" && file.startsWith(prefix))));
}

export type LandResult = { landed: boolean; how: string };

export async function landLane(root: string, base: string, branch: string): Promise<LandResult> {
  const ancestor = await git(root, ["merge-base", "--is-ancestor", base, branch]);
  const checkedOut = await currentBranch(root);
  if (ancestor.code !== 0) {
    if (checkedOut !== base) return { landed: false, how: `${base} moved since ${branch} started and is not checked out in the main working copy, so it cannot be merged there` };
    if (!(await isClean(root))) return { landed: false, how: `the main working copy on ${base} has uncommitted changes` };
    const merged = await mergeBranch(root, branch, `Land ${branch}`);
    if (merged.ok) return { landed: true, how: `merged ${branch} into ${base} in the main working copy` };
    return { landed: false, how: merged.conflicts.length > 0 ? `${branch} conflicts with ${base} in ${merged.conflicts.join(", ")}` : merged.message };
  }
  if (checkedOut === base) {
    if (!(await isClean(root))) return { landed: false, how: `the main working copy on ${base} has uncommitted changes` };
    const run = await git(root, ["merge", "--ff-only", branch]);
    return run.code === 0 ? { landed: true, how: `fast-forwarded ${base} in the main working copy` } : { landed: false, how: run.stderr.trim() || "fast-forward failed" };
  }
  const used = await git(root, ["worktree", "list", "--porcelain"]);
  if (used.stdout.split("\n").some((line) => line.trim() === `branch refs/heads/${base}`)) {
    return { landed: false, how: `${base} is checked out in another working copy` };
  }
  const run = await git(root, ["branch", "-f", base, branch]);
  return run.code === 0 ? { landed: true, how: `moved ${base} to ${branch}` } : { landed: false, how: run.stderr.trim() || "branch update failed" };
}

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
