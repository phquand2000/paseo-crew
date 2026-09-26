import type { Caller } from "./context.ts";
import type { Lane } from "../domain/lane.ts";
import { type Ledger, findTask, laneOfLead } from "../domain/ledger.ts";
import type { Task } from "../domain/task.ts";

/** The caller's own lane and one task of it, or why the Lead cannot act on it. */
export function laneTask(ledger: Ledger, caller: Caller, id: string): { lane: Lane; task: Task } | string {
  const lane = laneOfLead(ledger, caller.id);
  const task = findTask(ledger, id);
  if (!lane) return "You have no open lane.";
  if (!task || task.lane !== lane.id) return `${id} is not a task in your lane.`;
  return { lane, task };
}
