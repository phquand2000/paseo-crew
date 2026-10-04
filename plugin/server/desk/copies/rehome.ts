import { recordEvent } from "../store/event-log.ts";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { errorText } from "../../core/errors.ts";
import { git } from "../../core/git.ts";
import { realPath, worktreeRoot } from "../../core/paths.ts";
import type { Workspace, Workspaces } from "../../core/ports.ts";
import type { DeskBase } from "../base.ts";
import type { Ledger, Slot } from "../../domain/ledger.ts";
import type { Project } from "../project/project.ts";

type Desk = Pick<DeskBase, "ledgers" | "log">;

/**
 * Copies recorded before their folder moved behind a link go on record at their real path, each in a workspace there:
 * Codex's sandbox refuses a writable root through a link, and Paseo seats an agent where its workspace is.
 */
export async function rehomeCopies(
  desk: Desk,
  workspaces: Workspaces,
  project: Project,
  home: () => Promise<Workspace>,
): Promise<void> {
  const folder = realPath(join(worktreeRoot(), project.slug));
  const ledger = desk.ledgers.read(project);
  for (const slot of Object.values(ledger.slots)) {
    const real = existsSync(slot.path) ? realPath(slot.path) : slot.path;
    if (real === slot.path) continue;
    try {
      await rehome(desk, workspaces, project, slot, real, home);
    } catch (error) {
      desk.log(project, `working copy ${slot.id} stays on record at ${slot.path}: ${errorText(error)}`);
    }
  }
  settleHistory(desk, project, folder);
}

/** The copies already gone keep only history in their records, named as their folder is now. */
function settleHistory(desk: Desk, project: Project, folder: string): void {
  const seen = new Map<string, string>();
  const settle = (path: string | undefined): string | undefined => {
    if (!path) return path;
    const parent = dirname(path);
    if (!seen.has(parent)) seen.set(parent, realPath(parent));
    return seen.get(parent) === folder && parent !== folder ? join(folder, basename(path)) : path;
  };
  const records = (ledger: Ledger) => [...Object.values(ledger.lanes), ...Object.values(ledger.tasks)];
  if (records(desk.ledgers.read(project)).every((record) => settle(record.worktree) === record.worktree)) return;
  desk.ledgers.transact(project, (current) => {
    for (const record of records(current)) {
      const settled = settle(record.worktree);
      if (settled !== record.worktree) record.worktree = settled;
    }
  });
}

async function rehome(
  desk: Desk,
  workspaces: Workspaces,
  project: Project,
  slot: Slot,
  real: string,
  home: () => Promise<Workspace>,
): Promise<void> {
  const repaired = await git(project.root, ["worktree", "repair", real]);
  if (repaired.code !== 0) throw new Error(repaired.stderr.trim() || "git worktree repair failed");
  const workspaceId = slot.workspaceId ? await workspaceAt(workspaces, project, slot, real, home) : undefined;
  desk.ledgers.transact(project, (current) => move(current, slot, real, workspaceId));
  recordEvent(project, { kind: "slot.rehomed", slot: slot.id, path: real, workspace: workspaceId });
}

async function workspaceAt(
  workspaces: Workspaces,
  project: Project,
  slot: Slot,
  real: string,
  home: () => Promise<Workspace>,
): Promise<string> {
  const { project: paseoProject } = await home();
  if (!paseoProject) throw new Error("the project's workspace in Paseo names no Paseo project");
  const work = slot.lane ?? slot.task ?? "kept";
  return (await workspaces.make(`${project.slug} ${slot.id} · ${work}`, real, paseoProject)).id;
}

/** The old workspace is left: archiving it archives the seats still placed through the link. */
function move(ledger: Ledger, slot: Slot, real: string, workspaceId: string | undefined): void {
  const entry = ledger.slots[slot.id];
  if (entry?.path !== slot.path) return;
  entry.path = real;
  if (workspaceId) entry.workspaceId = workspaceId;
  for (const lane of Object.values(ledger.lanes)) {
    if (lane.worktree === slot.path) lane.worktree = real;
    if (workspaceId && slot.workspaceId && lane.workspaceId === slot.workspaceId) lane.workspaceId = workspaceId;
  }
  for (const task of Object.values(ledger.tasks)) if (task.worktree === slot.path) task.worktree = real;
}
