import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Disk } from "../../core/fs.ts";
import { stateRoot, worktreeRoot } from "../../core/paths.ts";
import { type Project, loadConfig } from "./project.ts";
import { projectTemp } from "./writes.ts";

export type DiskLevel = "ok" | "soft" | "hard";
export type DiskReading = { level: DiskLevel; free: number; soft: number; hard: number; where: string };
type Floors = { soft: number; hard: number };

/** The desk's own records: a disk too full for them stops the ledger itself, though it may hold far less than a build. */
const STATE_FLOORS: Floors = { soft: 10, hard: 3 };
const RANK: Record<DiskLevel, number> = { ok: 0, soft: 1, hard: 2 };

/** The project's copies as a sandbox sees them, or the root they are made under before the first. */
function copiesDir(project: Project): string {
  const dir = join(worktreeRoot(), project.slug);
  return existsSync(dir) ? realpathSync(dir) : worktreeRoot();
}

/** Each disk the project uses against its floors, each volume measured once; the reading told is the lowest. */
export function readDisk(disk: Disk, project: Project): DiskReading {
  const floors = loadConfig(project.state).diskFloorGiB;
  const places: [string, string, Floors][] = [
    ["the project's temp", projectTemp(project), floors],
    ["the project's copies", copiesDir(project), floors],
    ["the crew's state", realpathSync(stateRoot()), STATE_FLOORS],
  ];
  const measured = new Map<string, number>();
  const readings = places.map(([what, path, { soft, hard }]): DiskReading => {
    const volume = disk.volumeOf(path);
    const free = measured.get(volume) ?? disk.freeGiB(path);
    measured.set(volume, free);
    return { level: free < hard ? "hard" : free < soft ? "soft" : "ok", free, soft, hard, where: `${what} (${path})` };
  });
  return readings.reduce((low, each) => (RANK[each.level] > RANK[low.level] ? each : low));
}
