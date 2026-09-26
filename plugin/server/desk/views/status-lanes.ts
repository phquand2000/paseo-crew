import type { SeatView } from "../../core/paseo.ts";
import { minutesSince } from "../../core/time.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import { AT_WORK, type Task } from "../../domain/task.ts";
import { keptPeers } from "../seats/kept.ts";

type Seats = Map<string, SeatView>;

const SHOWN_OUTCOME = 300;

export function openLaneLines(ledger: Ledger, lane: Lane, seats: Seats, now: number, aims: boolean): string[] {
  const detour = lane.detourOf ? ` Clearing the way for ${lane.detourOf}.` : "";
  const on = lane.onBranch ? ", carried on in the project's own copy" : ` off ${lane.base}`;
  const tasks = Object.values(ledger.tasks).filter((task) => task.lane === lane.id);
  const taskLines = tasks.map(
    (task) => `- ${task.id} ${task.title}: ${task.status}${taskDetail(ledger, task, seats, now)}`,
  );
  return [
    `## ${lane.id} ${lane.title}`,
    "",
    `Branch ${lane.branch}${on}. Lead ${seatLine(seats, lane.lead, now)}.${detour}`,
    ...laneNotes(lane, now),
    ...(aims ? laneAim(lane) : []),
    "",
    ...(tasks.length === 0 ? ["- no tasks yet"] : taskLines),
    "",
  ];
}

export function waitingLaneLines(ledger: Ledger, pending: Lane[], aims: boolean): string[] {
  if (pending.length === 0) return [];
  const lines = ["## Waiting lanes", ""];
  for (const lane of pending) {
    const after = (lane.after ?? []).map((id) => {
      const other = ledger.lanes[id];
      const closed = other?.landed ? "landed" : "closed without landing";
      return `${id} ${other?.status === "closed" ? closed : (other?.status ?? "gone")}`;
    });
    const why = lane.onHold ? `. On hold: ${lane.onHold.reason}` : lane.held ? `. Not open: ${lane.held.why}` : "";
    lines.push(`- ${lane.id} ${lane.title}: after ${after.join(", ")}${why}`);
    if (aims) lines.push(...laneAim(lane).map((line) => `  ${line}`));
  }
  return [...lines, ""];
}

/** Where an open lane stands beyond its seats: on hold, reported ready, and a landing held for the Human. */
function laneNotes(lane: Lane, now: number): string[] {
  const land = lane.landApproval;
  const notes: string[] = [];
  if (lane.onHold)
    notes.push(`On hold for ${minutesSince(now, lane.onHold.at)} min: ${lane.onHold.reason} resume_lane lifts it.`);
  if (lane.ready) notes.push(`Reported ready ${minutesSince(now, lane.ready.at)} min ago.`);
  if (land?.approved)
    notes.push(`Landing approved by the Human ${minutesSince(now, land.approved.at)} min ago; land_lane lands it.`);
  else if (land) {
    const why = land.signals.join(" ") || "every landing here is approved first.";
    notes.push(`Landing waits ${minutesSince(now, land.since)} min for the Human's approval: ${why}`);
  }
  return notes;
}

function laneAim(lane: Lane): string[] {
  const outcome = lane.outcome.replace(/\s+/g, " ").trim();
  const shown = outcome.length > SHOWN_OUTCOME ? `${outcome.slice(0, SHOWN_OUTCOME).trimEnd()}…` : outcome;
  const writes =
    lane.writeSet.join(", ") || "not declared, so taken to reach every path this project keeps to one writer";
  return [
    `Outcome: ${shown}`,
    `Writes: ${writes}`,
    ...(lane.contracts.length > 0 ? [`Depends on: ${lane.contracts.join(", ")}`] : []),
  ];
}

export function seatLine(seats: Seats, id: string | undefined, now: number): string {
  if (!id) return "none";
  const seat = seats.get(id);
  if (!seat) return `${id} gone`;
  return seat.status === "idle" ? `${id} idle ${minutesSince(now, seat.updatedAt)} min` : `${id} ${seat.status}`;
}

/** How a task stands on its line: who works it, what it waits for, its hand-back, and its Peer while kept after it. */
function taskDetail(ledger: Ledger, task: Task, seats: Seats, now: number): string {
  if (AT_WORK.includes(task.status)) return `, Peer ${seatLine(seats, task.peer, now)}`;
  if (task.status === "waiting") {
    const after = task.after?.length ? `, after ${task.after.join(", ")}` : "";
    return `${after}${task.held ? `. Not started: ${task.held.why}` : ""}`;
  }
  const kept = keptPeers(ledger, task.lane).find((peer) => peer.task === task.id);
  const keeps =
    kept && seats.has(kept.id) ? `; its Peer ${seatLine(seats, kept.id, now)} is kept until you release it` : "";
  return `${task.handback ? `, hand-back ${minutesSince(now, task.handback.at)} min ago` : ""}${keeps}`;
}
