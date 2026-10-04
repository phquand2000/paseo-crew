import { recordEvent } from "../store/event-log.ts";
import { existsSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../../core/errors.ts";
import { removeWorktree } from "../../core/git.ts";
import type { Workspaces } from "../../core/ports.ts";
import { realPath, worktreeRoot } from "../../core/paths.ts";
import type { DeskBase } from "../base.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Project } from "../project/project.ts";
import { unsavedIn } from "./unsaved.ts";
import { dropSeatTemp } from "../project/writes.ts";

/** What the desk opened and nothing holds any more. Liveness is read under the ledger lock when used: `reserve` writes its row before `git worktree add`. */
export async function sweepCopies(
  { ledgers, log }: Pick<DeskBase, "ledgers" | "log">,
  workspaces: Workspaces,
  project: Project,
  busy: boolean,
): Promise<void> {
  await sweepWorkspaces({ ledgers, log }, workspaces, project, busy);
  const root = join(worktreeRoot(), project.slug);
  if (!existsSync(root)) return;
  // Read and listed inside the lock; removal outside it is safe because a slot id is never handed out twice.
  // Compared by real path: a slot recorded before the folder moved behind a link names its copy through the link.
  const live = (current: Ledger) => new Set(Object.values(current.slots).map((slot) => realPath(slot.path)));
  const held = live(ledgers.read(project));
  const strays = readdirSync(root)
    .map((name) => realPath(join(root, name)))
    .filter((path) => !held.has(path));
  for (const path of strays) {
    // Asked again just before, for a row reserved for a path from before ids stopped being reused.
    if (live(ledgers.read(project)).has(path)) continue;
    // Work no commit holds is the Human's to keep or throw away: Clean shows such a copy and never takes it.
    if (existsSync(join(path, ".git")) && (await unsavedIn(path))) continue;
    dropSeatTemp(project, path);
    await removeWorktree(project.root, path);
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Left for the next sweep, which asks again whether anything holds it.
    }
    recordEvent(project, { kind: "worktree.swept", path });
  }
  try {
    if (readdirSync(root).length === 0) rmdirSync(root);
  } catch {
    // Not empty yet, or gone already.
  }
}

/** Archives the Paseo workspaces the desk made that no slot or open lane holds; the project's own is left while `busy`. */
async function sweepWorkspaces(
  { ledgers, log }: Pick<DeskBase, "ledgers" | "log">,
  workspaces: Workspaces,
  project: Project,
  busy: boolean,
): Promise<void> {
  const heldIds = (ledger: Ledger): Set<string> => {
    const held = new Set<string>();
    for (const slot of Object.values(ledger.slots)) if (slot.workspaceId) held.add(slot.workspaceId);
    for (const lane of Object.values(ledger.lanes))
      if (lane.status === "open" && lane.workspaceId) held.add(lane.workspaceId);
    return held;
  };
  // Archiving a workspace archives every agent in it: one left at a copy's path from before a move still seats a Lead.
  const copies = (ledger: Ledger) => new Set(Object.values(ledger.slots).map((slot) => slot.path));
  for (const workspace of await workspaces.owned(project.slug)) {
    if (busy && workspace.name === project.slug) continue;
    const ledger = ledgers.read(project);
    if (heldIds(ledger).has(workspace.id) || copies(ledger).has(realPath(workspace.directory))) continue;
    try {
      await workspaces.archive(workspace.id);
      recordEvent(project, { kind: "workspace.swept", workspace: workspace.id, name: workspace.name });
    } catch (error) {
      log(project, `workspace ${workspace.name} could not be swept: ${errorText(error)}`);
    }
  }
}
