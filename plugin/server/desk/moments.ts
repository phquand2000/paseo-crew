import { type Task, loadLedger } from "./ledger.ts";
import { type Moment, letters } from "./letters.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";

/** Tells whoever supervises a task's lane of a moment SLP wakes it for: structure settled, a task struggling, a sharp turn. */
export async function tellMoment(
  desk: DeskServices,
  project: Project,
  task: Task,
  moment: Moment,
  what: string,
): Promise<void> {
  const opener = loadLedger(project.state).lanes[task.lane]?.opener;
  await desk.ctx.post(await desk.roster.supervisorFor(project, opener), letters.moment(moment, task, what));
}
