import { Lifecycle, type Moves } from "./lifecycle.ts";

export type TaskStatus = "waiting" | "running" | "done" | "rework" | "queued" | "merging" | "merged" | "failed" | "cut" | "stalled";

const IN_HAND: TaskStatus[] = ["running", "rework", "done", "failed", "stalled"];

const MOVES = {
  start: { from: ["waiting"], to: "running" },
  wait: { from: ["running"], to: "waiting" },
  handBack: { from: IN_HAND, to: "done" },
  // An accepted task goes back to the Peer kept on it: it is that Peer's ticket until its Lead releases it.
  rework: { from: [...IN_HAND, "merged"], to: "rework" },
  queue: { from: IN_HAND, to: "queued" },
  merge: { from: ["queued"], to: "merging" },
  requeue: { from: ["merging"], to: "queued" },
  merged: { from: ["merging"], to: "merged" },
  conflict: { from: ["merging"], to: "rework" },
  // Red with its lane brought in: the lane branch stays as it was, and the task is its Lead's to send back or accept over the gate.
  red: { from: ["merging"], to: "done" },
  fail: { from: ["queued", "merging"], to: "failed" },
  stall: { from: ["running", "rework", "failed"], to: "stalled" },
  lose: { from: ["running", "rework"], to: "stalled" },
  resume: { from: ["stalled"], to: "running" },
  cut: { from: ["waiting", ...IN_HAND, "queued"], to: "cut" },
} satisfies Moves<TaskStatus>;

export type TaskMove = keyof typeof MOVES;

export const TASK = new Lifecycle<TaskStatus, TaskMove>(MOVES);

export const DECIDED: readonly TaskStatus[] = ["queued", "merging", "merged", "cut"];
export const SETTLED: readonly TaskStatus[] = ["merged", "cut"];
export const IN_QUEUE: readonly TaskStatus[] = ["queued", "merging"];
export const AT_WORK: readonly TaskStatus[] = ["running", "rework"];
// A task in the lane's copy has it on its own branch from its start until it is merged or cut, a failed merge included.
export const HOLDS_COPY: readonly TaskStatus[] = ["running", "rework", "done", "failed", "stalled", "queued", "merging"];
export const ACTIVE: readonly TaskStatus[] = ["running", "rework", "queued", "merging"];
