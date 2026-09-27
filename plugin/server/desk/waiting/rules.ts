import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";

/** The ids an `after` names, as the ledger keys them, each once. */
export const afterIds = (ids: string[]): string[] => [...new Set(ids.map((id) => id.trim().toUpperCase()))];

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

/** The first of `after` through which `id` would come to wait for itself, following only what still waits. */
function loopThrough(id: string, after: string[], waitingAfter: (id: string) => string[] | undefined) {
  return after.find((first) => {
    const seen = new Set<string>();
    const next = [first];
    while (next.length > 0) {
      const at = next.pop()!;
      if (at === id) return true;
      if (seen.has(at)) continue;
      seen.add(at);
      next.push(...(waitingAfter(at) ?? []));
    }
    return false;
  });
}

/** Why a lane cannot wait on `after` instead: it no longer waits, one of them cannot be waited for, or it would loop. */
export function laneAfterProblem(ledger: Ledger, lane: Lane, after: string[]): string | undefined {
  if (lane.status !== "waiting")
    return `Lane ${lane.id} is ${lane.status}; after orders only a lane still waiting to open.`;
  const pending = waitsFor(ledger, after, lane.onBranch === true);
  if (typeof pending === "string") return `${pending} Take it out of after.`;
  const waiting = (id: string) => (ledger.lanes[id]?.status === "waiting" ? ledger.lanes[id].after : undefined);
  const loop = loopThrough(lane.id, after, waiting);
  return loop ? `Lane ${lane.id} would wait for itself through ${loop}, so it could never open.` : undefined;
}

/** Why a task cannot wait on `after` instead: it no longer waits, one of them cannot be waited for, or it would loop. */
export function taskAfterProblem(ledger: Ledger, task: Task, after: string[]): string | undefined {
  if (task.status !== "waiting")
    return `${task.id} is ${task.status}; after orders only a task still waiting to start.`;
  const pending = taskWaitsFor(ledger, task.lane, after);
  if (typeof pending === "string") return `${pending} Take it out of after.`;
  const waiting = (id: string) => (ledger.tasks[id]?.status === "waiting" ? ledger.tasks[id].after : undefined);
  const loop = loopThrough(task.id, after, waiting);
  return loop ? `${task.id} would wait for itself through ${loop}, so it could never start.` : undefined;
}
