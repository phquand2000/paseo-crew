import type { Amendment } from "./amendment.ts";
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

/** A lane's copy, the project's own, waiting to come back off `branch`, then dropped `into` its lane; only while still on it, since a later lane may own it. */
type Restoring = { writers: string[]; base: string; branch: string; into?: string };

/** A lane of work on the record: what it is for, where it runs, who leads it, and how far it has got. */
export type Lane = {
  id: string;
  title: string;
  outcome: string;
  acceptance: string[];
  appetite?: string;
  deadline?: string;
  outOfScope: string[];
  issue?: string;
  base: string;
  branch: string;
  detourOf?: string;
  onBranch?: boolean;
  /** Where an onBranch lane's own commits begin: the branch it carries on had history before it. */
  startSha?: string;
  worktree?: string;
  slot?: string;
  writeSet: string[];
  contracts: string[];
  lead?: string;
  workspaceId?: string;
  opener: string;
  status: LaneStatus;
  after?: string[];
  opening?: { isolate?: boolean; role?: string };
  held?: { why: string; tried?: boolean };
  /** Stopped by whoever supervises it: its seats read nothing, and nothing starts or lands, until it is resumed. */
  onHold?: { at: number; by: string; reason: string };
  /** When its Lead last reported it ready; an amendment takes it away, since what it was ready against has changed. */
  ready?: { at: number };
  /** A landing held for the Human, for the lane branch at `head`; approved, it lands without being asked again while that holds. */
  landApproval?: {
    since: number;
    head: string;
    signals: string[];
    evidence: string[];
    overGate: boolean;
    reason?: string;
    ready: boolean;
    approved?: { at: number; note: string };
  };
  landed?: boolean;
  closedAt?: number;
  amended?: Amendment[];
  restoring?: Restoring;
  landing?: { by: string; writers: string[] };
  openedAt: number;
  tasks: number;
  reviews?: number;
};
