import { Lifecycle, type Moves } from "./lifecycle.ts";

export type TaskStatus = "waiting" | "running" | "done" | "rework" | "queued" | "merging" | "merged" | "failed" | "cut" | "stalled";

const IN_HAND: TaskStatus[] = ["running", "rework", "done", "failed", "stalled"];

const MOVES = {
  start: { from: ["waiting"], to: "running" },
  wait: { from: ["running"], to: "waiting" },
  handBack: { from: IN_HAND, to: "done" },
  rework: { from: IN_HAND, to: "rework" },
  accept: { from: IN_HAND, to: "merged" },
  queue: { from: IN_HAND, to: "queued" },
  merge: { from: ["queued"], to: "merging" },
  requeue: { from: ["merging"], to: "queued" },
  merged: { from: ["merging"], to: "merged" },
  conflict: { from: ["merging"], to: "rework" },
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
export const HOLDS_COPY: readonly TaskStatus[] = ["running", "rework", "done", "stalled"];
export const ACTIVE: readonly TaskStatus[] = ["running", "rework", "queued", "merging"];
