import type { Lane, Ledger, Task } from "../store/ledger.ts";

/** The one rule for `after`, lanes and tasks alike: each must exist, one done counts, one dropped holds, the rest are waited for. */
function awaiting<T extends { id: string }>(
  after: string[],
  find: (id: string) => T | undefined,
  done: (entry: T) => boolean,
  dropped: (entry: T) => string | undefined,
  noun: string,
): T[] | string {
  const found = after.map(find);
  const missing = after.filter((_, index) => !found[index]);
  if (missing.length > 0) return `There is no ${noun} ${missing.join(", ")} to wait for.`;
  const gone = found.map((entry) => dropped(entry!)).find(Boolean);
  if (gone) return `${gone}, so nothing of it is there to build on.`;
  return found.filter((entry) => !done(entry!)) as T[];
}

/** Why a lane cannot wait on these, or the lanes of them still to land. */
export function waitsFor(ledger: Ledger, after: string[], onBranch: boolean): Lane[] | string {
  const pending = awaiting(
    after,
    (id) => ledger.lanes[id],
    (lane) => lane.landed === true,
    (lane) => (lane.status === "closed" && !lane.landed ? `Lane ${lane.id} closed without landing` : undefined),
    "lane",
  );
  if (typeof pending === "string") return pending;
  // A branch carried on merges nowhere: a lane opened off the base after it would not have its work.
  const carried = after.map((id) => ledger.lanes[id]!).find((lane) => lane.onBranch);
  if (carried && !onBranch)
    return `Lane ${carried.id} carries on ${carried.branch} and merges nowhere, so a lane waiting for it carries on that branch too: pass onBranch.`;
  return pending;
}

/** Why a task cannot wait on these, or the tasks of them still to be merged; only code tasks of its own lane count. */
export function taskWaitsFor(ledger: Ledger, lane: string, after: string[]): Task[] | string {
  const find = (id: string) => {
    const task = ledger.tasks[id];
    return task?.lane === lane && task.kind === "code" ? task : undefined;
  };
  return awaiting(
    after,
    find,
    (task) => task.status === "merged",
    (task) => (task.status === "cut" ? `${task.id} was cut` : undefined),
    "task in this lane",
  );
}
