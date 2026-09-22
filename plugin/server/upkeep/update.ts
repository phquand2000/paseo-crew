import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { UpdateView } from "../../shared/views.ts";
import { currentBranch, git } from "../core/git.ts";
import { PLUGIN_ID, nodeBin } from "../core/paths.ts";

export type UpdateContext = {
  dir: string;
  /** Where Paseo keeps the plugins it installed from Git itself. */
  managedRoot: string;
  running: number;
  install(dir: string): Promise<string | undefined>;
  reload(): void;
};

const paseoRange = (text: string | undefined): string | null => {
  try {
    return (JSON.parse(text ?? "") as { requirements?: { paseo?: string } }).requirements?.paseo ?? null;
  } catch {
    return null;
  }
};

async function out(dir: string, args: string[]): Promise<string | undefined> {
  const run = await git(dir, args);
  return run.code === 0 ? run.stdout.trim() : undefined;
}

export async function checkUpdate(ctx: UpdateContext): Promise<UpdateView> {
  const { dir } = ctx;
  const view: UpdateView = { dir, head: "", branch: null, upstream: null, behind: 0, ahead: 0, commits: [], installs: false, paseo: null, blocked: null, running: ctx.running, updated: null };
  const blocked = (why: string) => ({ ...view, blocked: why });
  if (dir.startsWith(`${ctx.managedRoot}/`)) return blocked(`Paseo installed this copy from Git: run \`paseo plugin update ${PLUGIN_ID}\`.`);
  view.head = (await out(dir, ["rev-parse", "--short", "HEAD"])) ?? "";
  if (!view.head) return blocked(`${dir} is not a Git checkout, so there is nothing to update it from.`);
  view.branch = (await currentBranch(dir)) ?? null;
  if (!view.branch) return blocked("The checkout is on no branch.");
  view.upstream = (await out(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])) ?? null;
  const remote = await out(dir, ["config", `branch.${view.branch}.remote`]);
  if (!view.upstream || !remote) return blocked(`${view.branch} follows no remote branch.`);
  const fetched = await git(dir, ["fetch", "--quiet", remote]);
  if (fetched.code !== 0) return blocked(`Could not fetch ${remote}: ${fetched.stderr.trim()}`);
  const [ahead, behind] = ((await out(dir, ["rev-list", "--left-right", "--count", "HEAD...@{u}"])) ?? "0\t0").split(/\s+/).map(Number);
  view.ahead = ahead ?? 0;
  view.behind = behind ?? 0;
  const log = (await out(dir, ["log", "--format=%h%x09%s", "-n", "30", "HEAD..@{u}"])) ?? "";
  view.commits = log ? log.split("\n").map((line) => ({ sha: line.split("\t")[0]!, subject: line.split("\t").slice(1).join("\t") })) : [];
  view.installs = Boolean(await out(dir, ["diff", "--name-only", "HEAD", "@{u}", "--", "package.json", "package-lock.json"]));
  const next = paseoRange(await out(dir, ["show", "@{u}:./paseo-plugin.json"]));
  view.paseo = next !== paseoRange(readFileSync(join(dir, "paseo-plugin.json"), "utf-8")) ? next : null;
  if (await out(dir, ["status", "--porcelain", "--untracked-files=no"])) return blocked("The checkout has uncommitted changes.");
  if (view.ahead > 0) return blocked(`${view.branch} has ${view.ahead} commit${view.ahead === 1 ? "" : "s"} ${view.upstream} does not, so it cannot move forward on its own.`);
  return view;
}

/** Moves the checkout forward only, installs what its packages now ask for, and reloads the plugin. */
export async function applyUpdate(ctx: UpdateContext): Promise<UpdateView> {
  const view = await checkUpdate(ctx);
  if (view.blocked || view.behind === 0) return view;
  const from = view.head;
  const moved = await git(ctx.dir, ["merge", "--ff-only", "--quiet", "@{u}"]);
  if (moved.code !== 0) return { ...view, blocked: `Could not move forward: ${moved.stderr.trim()}` };
  if (view.installs) {
    const failed = await ctx.install(ctx.dir);
    if (failed) {
      await git(ctx.dir, ["reset", "--keep", from]);
      return { ...view, blocked: `npm install failed, so the checkout is back on ${from}: ${failed}` };
    }
  }
  const to = (await out(ctx.dir, ["rev-parse", "--short", "HEAD"])) ?? "";
  ctx.reload();
  return { ...view, head: to, behind: 0, commits: [], updated: { from, to } };
}

export function npmInstall(dir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(join(dirname(nodeBin()), "npm"), ["install", "--no-audit", "--no-fund"], { cwd: dir, timeout: 300_000 }, (error, _stdout, stderr) => resolve(error ? String(stderr).trim().split("\n").slice(-3).join("\n") || error.message : undefined));
  });
}

/** After the answer is on its way: the reload stops the runtime that is sending it. */
export function reloadSoon(): void {
  setTimeout(() => {
    execFile("paseo", ["plugin", "reload", PLUGIN_ID], { timeout: 60_000 }, (error, _stdout, stderr) => {
      if (error) console.error(`${PLUGIN_ID}: plugin reload after the update failed:`, String(stderr) || error.message);
    });
  }, 1000);
}
