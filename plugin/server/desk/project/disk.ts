import { type Project, loadConfig } from "./project.ts";
import { projectTemp } from "./writes.ts";

export type DiskLevel = "ok" | "soft" | "hard";
export type DiskReading = { level: DiskLevel; free: number; soft: number; hard: number };

/** The free space on the volume holding the project's temp, against its floors. */
export function readDisk(freeGiB: (dir: string) => number, project: Project): DiskReading {
  const { soft, hard } = loadConfig(project.state).diskFloorGiB;
  const free = freeGiB(projectTemp(project));
  return { level: free < hard ? "hard" : free < soft ? "soft" : "ok", free, soft, hard };
}
