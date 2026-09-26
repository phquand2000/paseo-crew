import { firstOverlap, serialHits } from "../../core/scope.ts";
import { type Args, str, strs } from "../context.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, activeTasks } from "../../domain/ledger.ts";
import { taskWaitsFor } from "../waiting/rules.ts";

/** One task of a layout: its fields as `add_tasks` takes them, what it holds if it runs beside others, and what it waits for, its keys and task ids alike. */
type Planned = { key: string; args: Args; parallel: boolean; holds: string[]; after: string[] };

/**
 * The tasks in an order they can run in, or why they cannot: each key once, paths held by exactly the tasks that run beside
 * others, each `after` a key of it or a task of this lane still to be merged, and no loop. Tasks in the lane's copy
 * then run one after another in that order.
 */
export function readPlan(ledger: Ledger, lane: Lane, listed: Args[]): Planned[] | string {
  const tasks: Planned[] = listed.map((args) => ({
    key: str(args.key).trim().toUpperCase(),
    args,
    parallel: args.parallel === true,
    holds: strs(args.holds),
    after: [...new Set(strs(args.after).map((id) => id.trim().toUpperCase()))],
  }));
  const keys = new Set<string>();
  for (const task of tasks) {
    if (!task.key) return "Every task has a key, which the others name in after.";
    if (keys.has(task.key)) return `The key ${task.key} names two tasks; give each its own.`;
    if (ledger.tasks[task.key])
      return `The key ${task.key} is already a task of this project; pick keys that are not task ids.`;
    keys.add(task.key);
    if (task.parallel && task.holds.length === 0)
      return `${task.key} runs beside others but holds nothing: name the paths it writes meanwhile, as coarse as the work allows.`;
    if (!task.parallel && task.holds.length > 0)
      return `${task.key} holds ${task.holds.join(", ")} but runs in the lane's copy, which has one writer at a time: leave holds out, or give those paths as hints.`;
  }
  for (const task of tasks) {
    const outside = task.after.filter((id) => !keys.has(id));
    const found = outside.length > 0 ? taskWaitsFor(ledger, lane.id, outside) : [];
    if (typeof found === "string") return `${task.key}: ${found} Take it out of after.`;
  }
  const order: Planned[] = [];
  const placed = new Set<string>();
  while (order.length < tasks.length) {
    // Listed order wherever after leaves a choice.
    const next = tasks.find(
      (task) => !placed.has(task.key) && task.after.every((id) => !keys.has(id) || placed.has(id)),
    );
    if (!next)
      return `The tasks loop: ${tasks
        .filter((task) => !placed.has(task.key))
        .map((task) => task.key)
        .join(", ")} wait for each other, so none of them could ever start.`;
    order.push(next);
    placed.add(next.key);
  }
  let previous: string | undefined;
  for (const task of order) {
    if (task.parallel) continue;
    if (previous && !task.after.includes(previous)) task.after.push(previous);
    previous = task.key;
  }
  return order;
}

/** What in the layout would collide as the desk will run it: two tasks holding one path, or a held path the lane does not write. */
export function layoutProblems(ledger: Ledger, lane: Lane, plan: Planned[], serial: string[]): string[] {
  const findings: string[] = [];
  const before = new Map<string, Set<string>>();
  for (const task of plan) before.set(task.key, new Set(task.after.flatMap((id) => [id, ...(before.get(id) ?? [])])));
  const ordered = (a: Planned, b: Planned) => before.get(a.key)!.has(b.key) || before.get(b.key)!.has(a.key);
  for (const [index, task] of plan.entries()) {
    for (const other of plan.slice(index + 1)) {
      if (!(task.parallel || other.parallel) || ordered(task, other)) continue;
      const clash = firstOverlap(task.holds, other.holds);
      if (clash)
        findings.push(
          `${task.key} and ${other.key} may run at once and both hold ${clash}: order them with after, or split the paths.`,
        );
    }
    const hits = serialHits(task.holds, serial);
    if (hits.length > 0)
      findings.push(
        `${task.key} runs beside others but holds ${hits.join(", ")}, which only one writer at a time may write: run it in the lane's copy.`,
      );
    const loose = lane.writeSet.length > 0 ? task.holds.filter((path) => !firstOverlap([path], lane.writeSet)) : [];
    if (loose.length > 0)
      findings.push(
        `${task.key} holds ${loose.join(", ")}, outside the lane's write set ${lane.writeSet.join(", ")}: leave it out, or ask for the lane to take it.`,
      );
    for (const active of activeTasks(ledger, lane.id).filter((entry) => entry.kind === "code")) {
      if (before.get(task.key)!.has(active.id) || (!task.parallel && active.mode !== "parallel")) continue;
      const clash = firstOverlap(task.holds, active.holds);
      if (clash)
        findings.push(
          `${task.key} holds ${clash}, which ${active.id} holds and is still writing, and does not wait for it: add ${active.id} to its after, or leave those paths to ${active.id}.`,
        );
    }
  }
  return findings;
}
