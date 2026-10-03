import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dropDir } from "../../core/fs.ts";
import { realPath } from "../../core/paths.ts";
import type { Ledger } from "../../domain/ledger.ts";
import { ownCopyHolder } from "../../domain/ledger.ts";
import type { DeskBase } from "../base.ts";
import { workKey } from "../claims.ts";
import { recordEvent } from "../store/event-log.ts";
import type { Project } from "./project.ts";
import { projectTemp } from "./writes.ts";

export const SCRATCH_ENV = "CREW_SCRATCH";
export const CACHE_ENV = "CREW_CACHE";

const LANE_ID = /^L\d+$/;
const cacheRoot = (project: Project) => join(projectTemp(project), "cache");

/** What a lane's seats and gates keep between tasks and runs, made when first asked for. */
export function laneCache(project: Project, lane: string): string {
  const dir = join(cacheRoot(project), lane);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** The open lane working in `cwd`: the one a copy the desk made is for, or the one in the project's own copy. */
export function laneAt(ledger: Ledger, project: Project, cwd: string): string | undefined {
  const at = realPath(cwd);
  const slot = Object.values(ledger.slots).find((each) => realPath(each.path) === at);
  const id = slot
    ? (slot.lane ?? (slot.task ? ledger.tasks[slot.task]?.lane : undefined))
    : at === realPath(project.root)
      ? ownCopyHolder(Object.values(ledger.lanes))?.id
      : undefined;
  return id && ledger.lanes[id]?.status === "open" ? id : undefined;
}

/** A gate of `lane` runs while `run` does, so its cache is not removed from under it. */
export async function gating<T>(desk: Pick<DeskBase, "gating">, key: string, run: () => Promise<T>): Promise<T> {
  desk.gating.set(key, (desk.gating.get(key) ?? 0) + 1);
  try {
    return await run();
  } finally {
    const left = desk.gating.get(key)! - 1;
    if (left > 0) desk.gating.set(key, left);
    else desk.gating.delete(key);
  }
}

/** Removes the cache of each lane that is closed or gone, once no gate of it runs and nobody still writes in its copy. */
export function sweepCaches(desk: Pick<DeskBase, "gating">, project: Project, ledger: Ledger): void {
  const root = cacheRoot(project);
  if (!existsSync(root)) return;
  const writing = new Set(
    Object.values(ledger.slots)
      .filter((slot) => slot.releasing?.writers.length)
      .map((slot) => slot.lane),
  );
  for (const name of readdirSync(root)) {
    const lane = ledger.lanes[name];
    if (!LANE_ID.test(name) || lane?.status === "open" || lane?.status === "waiting" || lane?.restoring) continue;
    if (writing.has(name) || desk.gating.has(workKey(project, name))) continue;
    if (dropDir(join(root, name))) recordEvent(project, { kind: "cache.removed", lane: name });
  }
}
