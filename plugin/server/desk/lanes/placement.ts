import { firstOverlap, serialReach } from "../../core/scope.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, ownCopyHolder } from "../../domain/ledger.ts";
import type { Refusal } from "../refusal.ts";

/** An open lane a lane works beside, and what both may write: one-writer paths both reach, or where their scopes meet. */
export type Beside = { lane: string; paths: string[] };

type Scoped = Pick<Lane, "id" | "writeSet" | "contracts">;

/**
 * The open lanes a lane with this scope works beside, and what each may write that it does too. Never a refusal: every lane has
 * a copy and a branch of its own, so what two lanes both write meets when the second merges or lands, where its Lead settles
 * it. A lane that declares no write set may write any one-writer path, on either side.
 */
export function lanesBeside(serial: string[], open: Scoped[], writeSet: string[], contracts: string[]): Beside[] {
  const reach = (paths: string[]) => (paths.length === 0 ? serial : serialReach(paths, serial));
  const mine = reach(writeSet);
  return open.flatMap((other) => {
    const theirs = new Set(reach(other.writeSet));
    const met =
      writeSet.length > 0 && other.writeSet.length > 0
        ? (firstOverlap(writeSet, [...other.writeSet, ...other.contracts]) ?? firstOverlap(contracts, other.writeSet))
        : undefined;
    const paths = [...new Set([...mine.filter((path) => theirs.has(path)), ...(met ? [met] : [])])];
    return paths.length > 0 ? [{ lane: other.id, paths }] : [];
  });
}

type Placing = Pick<Lane, "onBranch" | "detourOf">;

/** Where a lane opens given the ledger as it stands, or why it cannot: decided in the transaction that records or opens it. */
export function placement(
  ledger: Ledger,
  lane: Placing,
  isolate: boolean,
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
