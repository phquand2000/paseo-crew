import type { Lane } from "../../server/domain/lane.ts";
import type { Task } from "../../server/domain/task.ts";

export const lane: Lane = {
  id: "L1",
  title: "Discounts",
  outcome: "Orders apply a percentage discount",
  acceptance: ["a 10% code lowers the total"],
  outOfScope: [],
  base: "main",
  branch: "lane/l1-discounts",
  writeSet: [],
  contracts: [],
  opener: "sup",
  status: "open",
  openedAt: 0,
  tasks: 1,
};
export const task: Task = {
  id: "L1-T1",
  lane: "L1",
  kind: "code",
  mode: "lane",
  title: "Apply discount",
  goal: "Totals reflect the code",
  acceptance: ["10% off"],
  hints: ["src/pricing.js"],
  holds: [],
  outOfScope: [],
  branch: "task/l1-t1-apply-discount",
  status: "running",
  openedAt: 0,
  updatedAt: 0,
  silent: 0,
};
export const gate = "npm test runs on the whole lane when you report it ready";
