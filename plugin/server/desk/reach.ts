import { covers, serialHits, uncovered } from "../core/scope.ts";
import { capped } from "../core/text.ts";
import { besideOf } from "./briefs.ts";
import type { Lane, Ledger, Task } from "./ledger.ts";

const SHOWN = 10;

/**
 * What of a task's changed files its Lead should weigh, one note each and each file once: in what a task beside it holds,
 * outside the lane's write set, or for a parallel task outside what it holds, a path one writer at a time may write marked.
 */
export function reachNotes(ledger: Ledger, task: Task, lane: Lane, files: string[], serial: string[]): string[] {
  const notes: string[] = [];
  const taken = new Set<string>();
  for (const other of besideOf(ledger, task)) {
    const into = files.filter((file) => covers(other.holds, file));
    for (const file of into) taken.add(file);
    if (into.length > 0) notes.push(`in what ${other.id} holds (${other.holds.join(", ")}): ${capped(into, SHOWN)}`);
  }
  const beyond = lane.writeSet.length > 0 ? uncovered(files, lane.writeSet).filter((file) => !taken.has(file)) : [];
  if (beyond.length > 0)
    notes.push(`outside the lane's write set (${lane.writeSet.join(", ")}): ${capped(beyond, SHOWN)}`);
  if (task.mode !== "parallel") return notes;
  const loose = uncovered(files, task.holds).filter((file) => !taken.has(file) && !beyond.includes(file));
  const oneWriter = new Set(serialHits(loose, serial));
  const named = loose.map((file) => (oneWriter.has(file) ? `${file} (one writer at a time)` : file));
  if (loose.length > 0) notes.push(`outside what it holds (${task.holds.join(", ")}): ${capped(named, SHOWN)}`);
  return notes;
}
