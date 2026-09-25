import { existsSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../core/errors.ts";
import { removeWorktree } from "../core/git.ts";
import type { Workspaces } from "../core/ports.ts";
import { worktreeRoot } from "../core/paths.ts";
import type { DeskContext } from "./context.ts";
import type { Ledger } from "./ledger.ts";
import type { Project } from "./project.ts";

/** What the desk opened and nothing holds any more. Liveness is read under the ledger lock when used: `reserve` writes its row before `git worktree add`. */
export async function sweepCopies(ctx: DeskContext, workspaces: Workspaces, project: Project, busy: boolean): Promise<void> {
  const heldIds = (ledger: Ledger): Set<string> => {
    const held = new Set<string>();
    for (const slot of Object.values(ledger.slots)) if (slot.workspaceId) held.add(slot.workspaceId);
    for (const lane of Object.values(ledger.lanes)) if (lane.status === "open" && lane.workspaceId) held.add(lane.workspaceId);
    return held;
  };
  for (const workspace of await workspaces.owned(project.slug)) {
    if (busy && workspace.name === project.slug) continue;
    if (ctx.read(project, (current) => heldIds(current).has(workspace.id))) continue;
    try {
      await workspaces.archive(workspace.id);
      ctx.event(project, { kind: "workspace.swept", workspace: workspace.id, name: workspace.name });
    } catch (error) {
      ctx.log(project, `workspace ${workspace.name} could not be swept: ${errorText(error)}`);
    }
  }
  const root = join(worktreeRoot(), project.slug);
  if (!root.startsWith(worktreeRoot()) || !existsSync(root)) return;
  // Read and listed inside the lock; removal outside it is safe because a slot id is never handed out twice.
  const live = (current: Ledger) => new Set(Object.values(current.slots).map((slot) => slot.path));
  const strays = ctx.read(project, (current) => {
    const held = live(current);
    return readdirSync(root)
      .map((name) => join(root, name))
      .filter((path) => !held.has(path));
  });
  for (const path of strays) {
    // Asked again just before, for a row reserved for a path from before ids stopped being reused.
    if (ctx.read(project, (current) => live(current).has(path))) continue;
    await removeWorktree(project.root, path);
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {}
    ctx.event(project, { kind: "worktree.swept", path });
  }
  try {
    if (readdirSync(root).length === 0) rmdirSync(root);
  } catch {}
}
