import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { workLetters } from "../letters/work-letters.ts";
import type { Project } from "../project/project.ts";
import type { Refusal } from "../refusal.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";

/** Why a lane or task cannot start yet, and what can be done; `tried` when its start failed rather than was never tried. */
export type Holding = Refusal & { tried?: true };

/** Keeps why a lane or task still waits, and tells whoever asked for it, once per reason, unless it was told already. */
export async function noteHeld(
  { ledgers, roster, mail }: Pick<DeskServices, "ledgers" | "roster" | "mail">,
  project: Project,
  entry: Lane | Task,
  holding: Holding,
  tell = true,
): Promise<void> {
  const task = "lane" in entry;
  const why = `${holding.why} ${holding.next}`;
  const changed = ledgers.transact(project, (current) => {
    const kept = task ? current.tasks[entry.id] : current.lanes[entry.id];
    if (!kept || kept.status !== "waiting" || kept.held?.why === why) return false;
    kept.held = { why, ...(holding.tried ? { tried: true } : {}) };
    return true;
  });
  if (!changed) return;
  recordEvent(
    project,
    task ? { kind: "task.held", task: entry.id, reason: why } : { kind: "lane.held", lane: entry.id, reason: why },
  );
  if (!tell) return;
  const to = task ? ledgers.read(project).lanes[entry.lane]?.lead : await roster.supervisorFor(project, entry.opener);
  await mail.post(to, workLetters.held(entry, holding.why, holding.next));
}
