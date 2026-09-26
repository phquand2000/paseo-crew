import { firstOverlap, serialHits } from "../../core/scope.ts";
import { IN_QUEUE } from "../../domain/task.ts";
import { holderOf } from "../holder.ts";
import { type Lane, type Ledger, activeTasks } from "../ledger.ts";
import type { Refusal } from "../refusal.ts";

/** Where a task may start in its lane, or why not: decided in the transaction that starts it. */
export function taskPlacement(
  ledger: Ledger,
  lane: Lane,
  holds: string[],
  parallel: boolean,
  serial: string[],
): Refusal | undefined {
  if (parallel) return parallelProblem(ledger, lane, holds, serial);
  const holder = holderOf(ledger, lane);
  if (!holder) return undefined;
  const beside = "or run this beside it in parallel, holding paths independent of it.";
  if (holder.status === "done" || holder.status === "failed") {
    const waits = holder.status === "done" ? "has handed back" : "failed to merge";
    return {
      why: `${holder.id} ${waits} and is waiting on you, and it still holds the lane's working copy — rework would wake its Peer in there.`,
      next: `Accept or cut it first, ${beside}`,
    };
  }
  const doing = IN_QUEUE.includes(holder.status)
    ? "is in the merge queue, and holds the lane's working copy until it merges."
    : "is still writing in the lane's working copy, and it holds one writer at a time.";
  return { why: `${holder.id} ${doing}`, next: `Pass after ${holder.id} to start this once it is merged, ${beside}` };
}

/** What a parallel task holding these paths would collide with: a one-writer path, or what a task beside it holds. */
export function parallelProblem(
  ledger: Ledger,
  lane: Lane,
  holds: string[],
  serial: string[],
  self?: string,
): Refusal | undefined {
  const hits = serialHits(holds, serial);
  if (hits.length > 0)
    return {
      why: `A parallel task can't hold ${hits.join(", ")}.`,
      next: "Run it in the lane's working copy instead.",
    };
  for (const task of activeTasks(ledger, lane.id).filter((entry) => entry.kind === "code" && entry.id !== self)) {
    const clash = firstOverlap(holds, task.holds);
    if (clash)
      return {
        why: `What it holds overlaps what ${task.id} holds at ${clash}.`,
        next: `Pass after ${task.id} instead of running it in parallel.`,
      };
  }
  return undefined;
}
