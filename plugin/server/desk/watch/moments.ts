import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import type { Moment } from "../letters/watch-letters.ts";
import { watchLetters } from "../letters/watch-letters.ts";
import type { Project } from "../project.ts";
import type { DeskServices } from "../services.ts";

/** Tells whoever supervises a task's lane of a moment SLP wakes it for: structure settled, a task struggling, a sharp turn. */
export async function tellMoment(
  desk: DeskServices,
  project: Project,
  task: Task,
  moment: Moment,
  what: string,
): Promise<void> {
  const opener = loadLedger(project.state).lanes[task.lane]?.opener;
  await desk.mail.post(await desk.roster.supervisorFor(project, opener), watchLetters.moment(moment, task, what));
}
