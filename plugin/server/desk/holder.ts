import { HOLDS_COPY } from "../domain/task.ts";
import type { Lane, Ledger, Task } from "./ledger.ts";

/** Tasks waiting on their Lead or the merge queue still hold the copy (it is on their branch), unless a stalled Peer's seat is gone. */
const holds = (task: Task): boolean =>
  HOLDS_COPY.includes(task.status) && !(task.status === "stalled" && task.peerGone);

/** The task whose Peer writes in a lane's copy, or waits there on its Lead: the copy holds one writer at a time. */
export function holderOf(ledger: Ledger, lane: Lane, except?: string): Task | undefined {
  return Object.values(ledger.tasks).find(
    (task) =>
      task.lane === lane.id && task.id !== except && task.kind === "code" && task.mode !== "parallel" && holds(task),
  );
}
