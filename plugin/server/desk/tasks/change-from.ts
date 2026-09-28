import { mergeBase, mergeTree } from "../../core/git.ts";
import type { Task } from "../../domain/task.ts";

/**
 * Where what a task changed up to `tip` is read from: where it meets the lane's `side`, or once it took base in, the tree the
 * lane and that base make together, so what either brought in is not the task's.
 */
export async function changeFrom(cwd: string, task: Task, side: string, tip: string): Promise<string | undefined> {
  const met = await mergeBase(cwd, side, tip);
  return met && task.tookBase ? mergeTree(cwd, met, task.tookBase.sha) : met;
}
