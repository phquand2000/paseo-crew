import { TASK, type Task, heldAtWork } from "../../domain/task.ts";
import { workLetters } from "../letters/work-letters.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { taskWaitsFor } from "./rules.ts";

type Woken = { task: Task; cut?: string };

/** Lets go each task its Lead held at work once what it waits for has merged or been cut, and tells its Peer to go on, once. */
export async function wakeHeld(desk: Pick<DeskServices, "ledgers" | "mail">, project: Project): Promise<void> {
  if (!Object.values(desk.ledgers.read(project).tasks).some(heldAtWork)) return;
  const woken = desk.ledgers.transact(project, (ledger) =>
    Object.values(ledger.tasks)
      .filter(heldAtWork)
      .flatMap((task): Woken[] => {
        const pending = taskWaitsFor(ledger, task.lane, task.after ?? []);
        if (Array.isArray(pending) && pending.length > 0) return [];
        delete task.held;
        if (task.status === "stalled") TASK.move(task, "resume");
        task.silent = 0;
        task.updatedAt = Date.now();
        return [{ task: { ...task }, ...(typeof pending === "string" ? { cut: pending } : {}) }];
      }),
  );
  for (const { task, cut } of woken) {
    recordEvent(project, { kind: "task.woken", task: task.id, cut: cut ?? null });
    await desk.mail.post(task.peer, workLetters.landed(task, task.after ?? [], cut));
  }
}
