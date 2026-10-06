import { type DiskReading, readDisk } from "../project/disk.ts";
import { diskLetters } from "../letters/disk-letters.ts";
import type { Letter } from "../letters/envelope.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { closeIncidentsOf, notice } from "./notice.ts";
import { pageDiskLow } from "./pager.ts";

/** The incident book files every finding against a seat; the disk's go against this one, which no agent ever is. */
const DISK = { id: "disk", provider: "", title: "the disks the project uses" };

/**
 * Each round, the disks the project uses against their floors, told only as the level changes. Under the hard floor is
 * a page at once, not a shadow: a full disk takes down what every lane shares and cannot be undone, and a reading cannot lie.
 */
export async function watchDisk(desk: DeskServices, project: Project, now = Date.now()): Promise<void> {
  const reading = readDisk(desk.disk, project);
  const known = desk.diskLevels.get(project.slug);
  desk.diskLevels.set(project.slug, reading.level);
  if (reading.level === (known ?? "ok")) return;
  recordEvent(project, { kind: "disk.level", level: reading.level, free: reading.free, where: reading.where });
  if (reading.level !== "hard") closeIncidentsOf(desk, project, DISK.id, now);
  if (reading.level === "hard") await notice(desk, project, DISK, [hardFinding(reading)], undefined, now);
  // Not on the first reading since the plugin started: that was told before the reload, and the tasks it holds say why.
  else if (reading.level === "soft" && known === "ok") await tellLow(desk, project, reading, now);
  else if (reading.level === "ok") await tell(desk, project, diskLetters.back(now));
}

function hardFinding({ free, hard, where }: DiskReading) {
  const quote = `low: ${where} has ${free} GiB free, under its hard floor of ${hard} GiB`;
  return { kind: "disk-low", level: "page" as const, quote, facts: [`${free} GiB free`] };
}

async function tellLow(desk: DeskServices, project: Project, reading: DiskReading, now: number): Promise<void> {
  await tell(desk, project, diskLetters.low(reading, now));
  await pageDiskLow(desk, project, reading);
}

async function tell(desk: DeskServices, project: Project, letter: Letter): Promise<void> {
  await desk.mail.post(await desk.roster.supervisorFor(project, undefined), letter);
}
