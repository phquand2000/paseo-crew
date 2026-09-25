import { type Lane, type Ledger, leadLaneOf, taskOfPeer } from "./ledger.ts";

/**
 * What Paseo shows a seat as, and the team it joins. A plugin cannot rename an agent, so the name is fixed when the seat
 * starts and names its team, which outlives any one lane or task; what the seat works on now is read from its binding.
 */
type Named = { team: string; title: string };

/** The team whose seats work a lane: its Lead's. */
function teamOf(ledger: Ledger, lane: Pick<Lane, "id" | "lead">): string {
  const team = ledger.agents[lane.lead ?? ""]?.team;
  if (!team) throw new Error(`lane ${lane.id} has no Lead of a team`);
  return team;
}

/** A new Lead starts a team, numbered in its project and never numbered again. */
export function newLead(ledger: Ledger): Named {
  ledger.seq.team = (ledger.seq.team ?? 0) + 1;
  const team = String(ledger.seq.team);
  return { team, title: `Team ${team} · Lead` };
}

/** A Lead in place of one gone joins the lane's team. */
export function nextLead(ledger: Ledger, lane: Pick<Lane, "id" | "lead">): Named {
  const team = teamOf(ledger, lane);
  return { team, title: `Team ${team} · Lead` };
}

/** A new Peer is numbered in its lane's team, and no number is used twice there. */
export function newPeer(ledger: Ledger, lane: Pick<Lane, "id" | "lead">): Named {
  const team = teamOf(ledger, lane);
  const peers = (ledger.seq.peers ??= {});
  peers[team] = (peers[team] ?? 0) + 1;
  return { team, title: `Team ${team} · Peer ${peers[team]}` };
}

/** A reviewer lives for one review, so its name can say what it reviews. */
export function newReviewer(ledger: Ledger, lane: Pick<Lane, "id" | "lead">, of: string): Named {
  const team = teamOf(ledger, lane);
  return { team, title: `Team ${team} · Review ${of}` };
}

/** A seat as a letter names it: what Paseo shows, then what its binding has it on now. */
export function seatWho(ledger: Ledger, seat: { id: string; title?: string | null }, label: string): string {
  const name = seat.title ?? `${label} ${seat.id}`;
  const task = taskOfPeer(ledger, seat.id);
  if (task) return `${name} on ${task.id} (${task.title})`;
  const lane = leadLaneOf(ledger, seat.id);
  return lane ? `${name} ${lane.status === "closed" ? "kept from" : "of"} ${lane.id} (${lane.title})` : name;
}
