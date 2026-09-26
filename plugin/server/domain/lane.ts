import { Lifecycle, type Moves } from "./lifecycle.ts";

export type LaneStatus = "waiting" | "open" | "closed";

const MOVES = {
  open: { from: ["waiting"], to: "open" },
  wait: { from: ["open"], to: "waiting" },
  close: { from: ["open"], to: "closed" },
  drop: { from: ["waiting"], to: "closed" },
} satisfies Moves<LaneStatus>;

export type LaneMove = keyof typeof MOVES;

export const LANE = new Lifecycle<LaneStatus, LaneMove>(MOVES);
