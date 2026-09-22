import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, rmSync, rmdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { CleanItem, CleanView } from "../../shared/views.ts";
import type { Kit } from "../catalog/kit.ts";
import type { Team } from "../catalog/team.ts";
import { git, pristineState } from "../core/git.ts";
import { contentRoot, expandHome, guidesDir, stateRoot, worktreeRoot } from "../core/paths.ts";
import { errorText } from "../core/errors.ts";
import { readLedger } from "../desk/ledger.ts";
import type { Project } from "../desk/project.ts";
import { BACKUP } from "./migrate.ts";
import { STATE_BACKUP } from "./state.ts";

export type CleanContext = {
  kit: Kit;
  home: string;
  known: Project[];
  teamFor(project: Project): Team;
  /** The seats Paseo has open, by provider and the project their cwd is in. */
  live: { provider: string; slug: string }[];
};

function bytesOf(path: string): number {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const name of readdirSync(path)) total += bytesOf(join(path, name));
  return total;
}

function entries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

const item = (path: string, kind: CleanItem["kind"], why: string, extra: Partial<CleanItem> = {}): CleanItem => ({ path, kind, why, bytes: bytesOf(path), careful: false, held: null, ...extra });

/**
 * Seat directories are named `<prefix><role>-<agent>-<slug>`, one per role, agent and project, and
 * nothing ever removes one: a detached project, or a role moved to another agent, leaves them behind
 * with every transcript the seat wrote. One an open seat still runs in is never garbage, whatever the
 * settings say now — its harness is reading it.
 */
function seats(ctx: CleanContext): CleanItem[] {
  const { kit } = ctx;
  const attached = new Map(ctx.known.map((project) => [project.slug, project]));
  const running = new Set(ctx.live.map((seat) => `${seat.provider}|${seat.slug}`));
  const roots = new Set(Object.values(kit.harnesses).map((harness) => expandHome(harness.profileRoot, ctx.home)));
  const agents = Object.keys(kit.harnesses).map((id) => id.replace(/[^a-z0-9]/gi, "\\$&")).join("|");
  const named = new RegExp(`^${kit.prefix.replace(/[^a-z0-9]/gi, "\\$&")}([a-z]+)-(${agents})-([a-z0-9-]+-[0-9a-f]{6})$`);
  const found: CleanItem[] = [];
  for (const root of roots) {
    for (const name of entries(root)) {
      const [, role, agent, slug] = named.exec(name) ?? [];
      if (!role || !agent || !slug) continue;
      if (running.has(`${kit.prefix}${role}-${agent}|${slug}`)) continue;
      const path = join(root, name);
      const project = attached.get(slug);
      const spec = kit.roles.find((entry) => entry.role === role);
      const now = project && spec ? ctx.teamFor(project).roles[role]?.harness : undefined;
      if (!project) found.push(item(path, "seat", `${slug} is not attached`));
      else if (!spec) found.push(item(path, "seat", `this version has no ${role} role`));
      else if (now && now.id !== agent) found.push(item(path, "seat", `the ${spec.label} sits on ${now.label} now`));
    }
  }
  return found;
}

/** A working copy the desk holds no slot for, and every copy of a project that is not attached. */
async function copies(ctx: CleanContext): Promise<CleanItem[]> {
  const root = worktreeRoot(ctx.home);
  const attached = new Map(ctx.known.map((project) => [project.slug, project]));
  const found: CleanItem[] = [];
  for (const slug of entries(root)) {
    const project = attached.get(slug);
    let held: Set<string>;
    try {
      held = new Set(project ? Object.values(readLedger(project.state).slots).map((slot) => resolve(slot.path)) : []);
    } catch {
      // A ledger that will not read says nothing about which copies are free, so none of them are.
      continue;
    }
    for (const name of entries(join(root, slug))) {
      const path = join(root, slug, name);
      if (held.has(resolve(path))) continue;
      const why = project ? "the desk holds no slot for it" : `${slug} is not attached`;
      // A copy with work in it that no slot names is most likely a seat's that crashed: that work is
      // in no commit, so it is shown and left for the owner to look at.
      const state = existsSync(join(path, ".git")) ? await pristineState(path) : "clean";
      found.push(item(path, "copy", why, state === "clean" ? {} : { held: state === "dirty" ? "it has uncommitted changes" : "git could not read it" }));
    }
  }
  return found;
}

/**
 * A project's records outlive Detach on purpose, so attaching it again finds its lanes and its
 * CONTEXT.md. They are garbage only once the owner says so, or once the project itself is gone.
 */
function records(ctx: CleanContext): CleanItem[] {
  const base = join(stateRoot(ctx.home), "projects");
  const attached = new Map(ctx.known.map((project) => [project.slug, project]));
  const found: CleanItem[] = [];
  for (const slug of entries(base)) {
    const path = join(base, slug);
    const project = attached.get(slug);
    if (project && existsSync(project.root)) continue;
    const concept = existsSync(join(path, "CONTEXT.md"));
    const why = project ? `attached, but ${project.root} is gone` : "detached; attaching it again would find its lanes";
    found.push(item(path, "records", concept ? `${why}. It holds the project's CONTEXT.md` : why, { careful: concept || !project }));
  }
  return found;
}

function linksInto(dir: string, root: string, depth: number, into: Set<string>): void {
  for (const name of entries(dir)) {
    const path = join(dir, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      const real = isAbsolute(target) ? target : resolve(dir, target);
      if (real.startsWith(`${root}/`)) into.add(real.slice(root.length + 1).split("/")[0]!);
    } else if (stat.isDirectory() && depth > 0) linksInto(path, root, depth - 1, into);
  }
}

/** A copy of the guides or a skill no seat directory links to: the sweep would take it in two weeks. */
function snapshots(ctx: CleanContext): CleanItem[] {
  const root = contentRoot(ctx.home);
  const linked = new Set<string>();
  linksInto(dirname(guidesDir(ctx.home)), root, 0, linked);
  for (const harness of Object.values(ctx.kit.harnesses)) {
    const seatRoot = expandHome(harness.profileRoot, ctx.home);
    for (const name of entries(seatRoot)) if (name.startsWith(ctx.kit.prefix)) linksInto(join(seatRoot, name), root, 3, linked);
  }
  return entries(root)
    .filter((name) => !linked.has(name) && !/\.\d+\.building$/.test(name))
    .map((name) => item(join(root, name), "snapshot", "no seat links to it"));
}

/** What Migrate put aside before changing a settings file. They can hold the sensor's key. */
function backups(ctx: CleanContext): CleanItem[] {
  const root = stateRoot(ctx.home);
  const dirs = [root, ...entries(join(root, "projects")).map((slug) => join(root, "projects", slug))];
  return dirs.flatMap((dir) =>
    entries(dir).flatMap((name) =>
      BACKUP.test(name)
        ? [item(join(dir, name), "backup", "a copy Migrate kept of settings it repaired; it can hold the sensor key")]
        : STATE_BACKUP.test(name)
          ? [item(join(dir, name), "backup", "the files as they were before an upgrade of their format; it can hold the sensor key")]
          : [],
    ),
  );
}

export async function scanGarbage(ctx: CleanContext): Promise<CleanItem[]> {
  return [...seats(ctx), ...(await copies(ctx)), ...records(ctx), ...snapshots(ctx), ...backups(ctx)];
}

/** The repository a linked working copy belongs to, read before the copy is gone. */
function commonDir(copy: string): string | undefined {
  try {
    const gitdir = /^gitdir: (.+)$/m.exec(readFileSync(join(copy, ".git"), "utf-8"))?.[1]?.trim();
    return gitdir ? dirname(dirname(gitdir)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Removes only what a scan made now still finds, and can remove: the list the owner picked from
 * was made earlier, and a seat may have started in one of those folders since.
 */
export async function removeGarbage(ctx: CleanContext, picked: string[]): Promise<CleanView> {
  const now = new Map((await scanGarbage(ctx)).map((found) => [found.path, found]));
  const removed: string[] = [];
  const failed: CleanView["failed"] = [];
  for (const path of picked) {
    const found = now.get(path);
    if (!found || found.held) {
      failed.push({ path, error: found?.held ?? "it is in use now, or already gone" });
      continue;
    }
    try {
      const common = found.kind === "copy" ? commonDir(path) : undefined;
      rmSync(path, { recursive: true, force: true });
      if (common && existsSync(common)) await git(common, ["worktree", "prune"]);
      if (found.kind === "copy" && entries(dirname(path)).length === 0) rmdirSync(dirname(path));
      removed.push(path);
    } catch (error) {
      failed.push({ path, error: errorText(error) });
    }
  }
  return { items: await scanGarbage(ctx), removed, failed };
}
