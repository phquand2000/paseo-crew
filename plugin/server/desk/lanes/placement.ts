import { capped } from "../../core/text.ts";
import { firstOverlap, serialReach } from "../../core/scope.ts";
import { type Lane, type Ledger, ownCopyHolder } from "../ledger.ts";
import type { Refusal } from "../refusal.ts";

/** Why a lane with this write set may not open beside the open lanes: a path only one lane at a time may write, or an overlap. */
export function scopeProblem(
  serial: string[],
  open: Lane[],
  writeSet: string[],
  contracts: string[],
): Refusal | undefined {
  if (open.length === 0) return undefined;
  const mine = serialReach(writeSet, serial);
  for (const other of open) {
    // No write set could mean any of them, and a copy of its own does not help: a merge cannot reconcile these.
    const theirs = new Set(other.writeSet.length === 0 ? serial : serialReach(other.writeSet, serial));
    const both = mine.filter((path) => theirs.has(path));
    // Capped at four: resolved against real files, a Unity or Unreal tree can match tens of thousands.
    if (both.length > 0)
      return {
        why: `Lane ${other.id} may already be writing ${capped(both, 4)}, and only one lane at a time may write those.`,
        next: `Open this lane after ${other.id} lands, or keep those paths out of it.`,
      };
  }
  // Nothing is said when either declared nothing: that is the Supervisor's call, not a hole to refuse over.
  for (const other of open) {
    if (writeSet.length === 0 || other.writeSet.length === 0) continue;
    const clash =
      firstOverlap(writeSet, [...other.writeSet, ...other.contracts]) ?? firstOverlap(contracts, other.writeSet);
    if (clash)
      return {
        why: `This lane overlaps lane ${other.id} at ${clash}.`,
        next: `Fold it in or open it after ${other.id} lands.`,
      };
  }
  return undefined;
}

type Placing = Pick<Lane, "onBranch" | "writeSet" | "contracts" | "detourOf">;

/** Where a lane opens given the ledger as it stands, or why it cannot: decided in the transaction that records or opens it. */
export function placement(
  ledger: Ledger,
  lane: Placing,
  isolate: boolean,
  serial: string[],
  self?: string,
): { ownCopy: boolean } | Refusal {
  const lanes = Object.values(ledger.lanes).filter((entry) => entry.id !== self);
  const open = lanes.filter((entry) => entry.status === "open");
  const holder = ownCopyHolder(lanes);
  if (lane.onBranch && holder)
    return {
      why: `Lane ${holder.id} is working in the project's own copy on ${holder.branch}, and one checkout holds one branch.`,
      next: `Carry this branch on once ${holder.id} closes, or open the lane on a branch of its own.`,
    };
  // A detour must name a real open lane, or the letter back out of it has nowhere to go.
  if (lane.detourOf && !open.some((entry) => entry.id === lane.detourOf))
    return { why: `There is no open lane ${lane.detourOf} for this one to clear the way for.`, next: "" };
  const problem = scopeProblem(serial, open, lane.writeSet, lane.contracts);
  if (problem) return problem;
  // One checkout is one branch, so whether to wait for it or take a copy is the Supervisor's call; a detour cannot wait.
  if (holder && !isolate && !lane.onBranch && !lane.detourOf) return ownCopyTaken(holder);
  return { ownCopy: !lane.onBranch && (isolate || holder !== undefined) };
}

function ownCopyTaken(holder: Lane): Refusal {
  if (holder.status === "open")
    return {
      why: `Lane ${holder.id} is working in the project's own copy on ${holder.branch}.`,
      next: `Pass isolate to open this lane in a copy of its own now, or open it with after ${holder.id} to work in the project's copy once that lane lands.`,
    };
  return {
    why: `Lane ${holder.id} is closed, but its Lead is still ending a turn in the project's own copy, which goes back to ${holder.base} when that turn ends.`,
    next: "Pass isolate to open this lane in a copy of its own now, or open it again once status shows the copy is back.",
  };
}
