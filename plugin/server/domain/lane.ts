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

/** A line of the lane's acceptance or out of scope that the Human asked for, with their words; `dropped` once a change took it without them. */
export type HumanLine = { line: string; question?: string; quote?: string; dropped?: { at: number; by: string } };

/** A lane of work on the record: what it is for, where it runs, who leads it, and how far it has got. */
export type Lane = {
  id: string;
  title: string;
  outcome: string;
  acceptance: string[];
  appetite?: string;
  deadline?: string;
  outOfScope: string[];
  human?: HumanLine[];
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
  /** How often READY was taken away: a report whose gate ran meanwhile sees the lane changed under it. */
  readyLost?: number;
  /** A landing held for the Human, for the lane branch at `head`; approved, it lands without being asked again while that holds. */
  landApproval?: {
    since: number;
    head: string;
    signals: string[];
    paths: string[];
    evidence: string[];
    overGate: boolean;
    reason?: string;
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

/** Takes READY away, counting it, as whatever changes what the lane holds or is asked does. */
export function loseReady(lane: Lane): void {
  delete lane.ready;
  lane.readyLost = (lane.readyLost ?? 0) + 1;
}

/** The lines the Human's word stands behind, cited as it came: an answered question, or what they wrote. */
export type HumanClaim = { line: string; question?: string; quote?: string };

/**
 * Keeps the Human's lines in step with what the lane asks now: `claims` are theirs, and one gone that no claim covers
 * stays on record as dropped. Returns the lines dropped now, or the claim that names no line.
 */
export function carryHuman(lane: Lane, claims: HumanClaim[], by: string, at = Date.now()): HumanLine[] | HumanClaim {
  const now = new Set([...lane.acceptance, ...lane.outOfScope]);
  const named = new Set(claims.map((claim) => claim.line));
  const kept = lane.human ?? [];
  const live = kept.filter((entry) => !entry.dropped);
  const stray = claims.find((claim) => !now.has(claim.line) && !live.some((entry) => entry.line === claim.line));
  if (stray) return stray;
  const dropped = live
    .filter((entry) => !now.has(entry.line) && !named.has(entry.line))
    .map((entry) => ({ ...entry, dropped: { at, by } }));
  const human = [
    ...kept.filter((entry) => entry.dropped),
    ...dropped,
    ...live.filter((entry) => now.has(entry.line) && !named.has(entry.line)),
    ...claims.filter((claim) => now.has(claim.line)),
  ];
  if (human.length > 0) lane.human = human;
  else delete lane.human;
  return dropped;
}
