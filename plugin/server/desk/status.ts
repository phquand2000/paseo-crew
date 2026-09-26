import type { SeatView } from "../core/paseo.ts";
import { AT_WORK } from "../domain/task.ts";
import { keptCopy, keptPeers } from "./kept.ts";
import { type Lane, type Ledger, type Task, ownCopyHolder } from "./ledger.ts";
import { type LaneHome, type Project, type ProjectConfig, laneHomeFor, projectOf } from "./project.ts";

const minutes = (now: number, at: number | string) => Math.max(0, Math.round((now - (typeof at === "string" ? Date.parse(at) : at)) / 60_000));
const left = (ms: number) => (ms > 86_400_000 ? `${Math.ceil(ms / 86_400_000)} days` : `${Math.max(1, Math.ceil(ms / 3_600_000))} h`);

function seatLine(seats: Map<string, SeatView>, id: string | undefined, now: number): string {
  if (!id) return "none";
  const seat = seats.get(id);
  if (!seat) return `${id} gone`;
  return seat.status === "idle" ? `${id} idle ${minutes(now, seat.updatedAt)} min` : `${id} ${seat.status}`;
}

/** How a task stands on its line: who works it, what it waits for, its hand-back, and its Peer while kept after it. */
function taskDetail(ledger: Ledger, task: Task, seats: Map<string, SeatView>, now: number): string {
  if (AT_WORK.includes(task.status)) return `, Peer ${seatLine(seats, task.peer, now)}`;
  if (task.status === "waiting") return `${task.after?.length ? `, after ${task.after.join(", ")}` : ""}${task.held ? `. Not started: ${task.held.why}` : ""}`;
  const kept = keptPeers(ledger, task.lane).find((peer) => peer.task === task.id);
  const keeps = kept && seats.has(kept.id) ? `; its Peer ${seatLine(seats, kept.id, now)} is kept until you release it` : "";
  return `${task.handback ? `, hand-back ${minutes(now, task.handback.at)} min ago` : ""}${keeps}`;
}

/** Leads kept after their lane closed, for whoever supervises to release: how long each has sat idle, and the copy it holds. */
function keptLines(ledger: Ledger, seats: Map<string, SeatView>, now: number): string[] {
  const kept = Object.values(ledger.lanes).filter((lane) => lane.status === "closed" && lane.lead && seats.has(lane.lead) && ledger.agents[lane.lead]?.lane === lane.id);
  if (kept.length === 0) return [];
  const line = (lane: Lane) => `- ${lane.id} ${lane.title}, ${lane.landed ? "landed" : "dropped"}: Lead ${seatLine(seats, lane.lead, now)}${keptCopy(ledger, lane) ? `, in ${lane.slot}` : ""}. release lane ${lane.id} once its work is done or the Human asks.`;
  return ["## Kept Leads", "", ...kept.map(line), ""];
}

/** What the status tool read from the project's own checkout; `work` is undefined when git could not say. */
export type OwnCopy = { branch?: string; head?: string; work?: string[] };

const SHOWN_FILES = 10;
const SHOWN_OUTCOME = 300;

const HOMES: Record<LaneHome, string> = { onBranch: "carrying on the branch this copy is on", newBranch: "on a new branch off the base in this copy", isolate: "in a copy of their own" };

/** Names a choice for the Human only where one is real: uncommitted work, or a branch that is not the base, with no lane in the copy. */
function ownCopyLines(project: Project, ledger: Ledger, config: ProjectConfig, copy: OwnCopy): string[] {
  const at = copy.branch ? `on ${copy.branch}` : `not on a branch (detached at ${copy.head ?? "an unknown commit"})`;
  const work = copy.work ? [...copy.work].sort() : undefined;
  const more = work && work.length > SHOWN_FILES ? `, and ${work.length - SHOWN_FILES} more` : "";
  const state = !work ? "and git could not say what is uncommitted" : work.length === 0 ? "clean" : `with ${work.length} uncommitted ${work.length === 1 ? "file" : "files"}: ${work.slice(0, SHOWN_FILES).join(", ")}${more}`;
  const holder = ownCopyHolder(Object.values(ledger.lanes));
  const held = holder?.status === "open" ? `Lane ${holder.id} is working in it.` : holder ? `Lane ${holder.id} is closed, and its Lead is ending a turn in it; it goes back to ${holder.base} after.` : "No lane is working in it.";
  const lines = ["## The project's own copy", "", `${project.root} is ${at}, ${state}.`, held];
  if (config.laneHome) lines.push(`Lanes open ${HOMES[config.laneHome]}, as the Human chose for every lane (laneHome).`);
  const home = holder ? undefined : laneHomeFor(undefined, config, copy.branch, work);
  if (typeof home === "object") lines.push(`The Human decides where the next lane works, before it opens: ${home.question}.`);
  lines.push("");
  return lines;
}

/** Where an open lane stands beyond its seats: on hold, reported ready, and a landing held for the Human. */
function laneNotes(lane: Lane, now: number): string[] {
  const land = lane.landApproval;
  return [
    ...(lane.onHold ? [`On hold for ${minutes(now, lane.onHold.at)} min: ${lane.onHold.reason} resume_lane lifts it.`] : []),
    ...(lane.ready ? [`Reported ready ${minutes(now, lane.ready.at)} min ago.`] : []),
    ...(land?.approved
      ? [`Landing approved by the Human ${minutes(now, land.approved.at)} min ago; land_lane lands it.`]
      : land
        ? [`Landing waits ${minutes(now, land.since)} min for the Human's approval: ${land.signals.join(" ") || "every landing here is approved first."}`]
        : []),
  ];
}

/** The questions still before the Human, each with what goes ahead while they are silent. */
function questionLines(ledger: Ledger, now: number): string[] {
  const open = Object.values(ledger.questions).filter((question) => question.status === "open");
  if (open.length === 0) return [];
  return ["", "## Questions for the Human", "", ...open.map((question) => `- ${question.id} (${question.class}${question.lane ? `, ${question.lane}` : ""}), open ${minutes(now, question.openedAt)} min: ${question.question.slice(0, 160)} Recommended: ${question.recommend}. While silent: ${question.ifSilent.slice(0, 160)}`)];
}

function laneAim(lane: Lane): string[] {
  const outcome = lane.outcome.replace(/\s+/g, " ").trim();
  return [
    `Outcome: ${outcome.length > SHOWN_OUTCOME ? `${outcome.slice(0, SHOWN_OUTCOME).trimEnd()}…` : outcome}`,
    `Writes: ${lane.writeSet.join(", ") || "not declared, so taken to reach every path this project keeps to one writer"}`,
    ...(lane.contracts.length > 0 ? [`Depends on: ${lane.contracts.join(", ")}`] : []),
  ];
}

/** To the minute, like every age on the page: a status asked again within it reads the same when nothing moved. */
const stamp = (now: number): string => `${new Date(now).toISOString().slice(0, 16)}Z`;

/** How the project is set up, the Human's standing orders included. */
function heading(project: Project, config: ProjectConfig, now: number): string[] {
  const gate = config.gate || (config.gate === "" ? "none, by this project's own choice" : "none");
  const asked = config.askFirst.length > 0 ? `A landing that touches ${config.askFirst.join(", ")} waits for the Human (askFirst).` : "No landing waits for the Human (askFirst is empty).";
  const rules = config.riskRules ? `Risk rules of its own: ${config.riskRules.length}.` : "The kit's risk rules.";
  return [`# Status: ${project.root}`, "", `Updated ${stamp(now)}. Base ${config.base ?? "unset"}. Gate ${gate}. Lanes land as ${config.landAs}. ${asked} ${rules}`, ""];
}

export function statusText(
  project: Project,
  ledger: Ledger,
  config: ProjectConfig,
  seats: Map<string, SeatView>,
  now: number,
  { laneId, waiting = [], held = [], copy }: { laneId?: string; waiting?: SeatView[]; held?: { to: string; text: string; at: number; until: number }[]; copy?: OwnCopy } = {},
): string {
  const lines = heading(project, config, now);
  if (copy) lines.push(...ownCopyLines(project, ledger, config, copy));
  // One outbox holds every project's mail: a seated recipient belongs to its copy's project, a gone one to this project's record.
  const mine = held.filter((letter) => {
    const seat = seats.get(letter.to);
    return seat ? Boolean(seat.cwd) && projectOf(seat.cwd).slug === project.slug : Boolean(ledger.agents[letter.to]);
  });
  const stranded = mine.filter((letter) => !seats.has(letter.to));
  const queued = mine.filter((letter) => seats.has(letter.to));
  if (stranded.length > 0) {
    lines.push("## Mail with nobody to read it", "", "The seat each of these was addressed to is gone, and no other seat is sent them: pass on what still matters before each is given up on.", "");
    for (const letter of stranded) {
      const first = letter.text.split(/\r?\n/).find((line) => line.trim()) ?? "";
      lines.push(`- to ${letter.to}, waiting ${minutes(now, letter.at)} min, given up on in ${left(letter.until - now)}: ${first.slice(0, 160)}`);
    }
    lines.push("");
  }
  // Held for a seat that is there but has not taken it: this is where a letter going nowhere shows.
  if (queued.length > 0) {
    lines.push("## Mail waiting to be taken", "", "The seat is there and has not read these yet.", "");
    for (const letter of queued) lines.push(`- to ${letter.to}, waiting ${minutes(now, letter.at)} min (${seats.get(letter.to)?.status ?? "unknown"})`);
    lines.push("");
  }
  if (waiting.length > 0) {
    lines.push("## Waiting on the Human", "");
    for (const seat of waiting) {
      const asked = (seat.pendingPermissions ?? []).map((request) => request.title ?? request.name ?? "a request").join("; ");
      lines.push(`- ${seat.title ?? seat.id} (${seat.id}): ${asked}`);
    }
    lines.push("");
  }
  const lanes = Object.values(ledger.lanes).filter((lane) => (laneId ? lane.id === laneId : true));
  const open = lanes.filter((lane) => lane.status === "open");
  if (open.length === 0) lines.push("No open lanes.", "");
  for (const lane of open) {
    const detour = lane.detourOf ? ` Clearing the way for ${lane.detourOf}.` : "";
    lines.push(`## ${lane.id} ${lane.title}`, "", `Branch ${lane.branch}${lane.onBranch ? ", carried on in the project's own copy" : ` off ${lane.base}`}. Lead ${seatLine(seats, lane.lead, now)}.${detour}`, ...laneNotes(lane, now), ...(copy ? laneAim(lane) : []), "");
    const tasks = Object.values(ledger.tasks).filter((task) => task.lane === lane.id);
    if (tasks.length === 0) lines.push("- no tasks yet");
    for (const task of tasks) lines.push(`- ${task.id} ${task.title}: ${task.status}${taskDetail(ledger, task, seats, now)}`);
    lines.push("");
  }
  const pending = lanes.filter((lane) => lane.status === "waiting");
  if (pending.length > 0) lines.push("## Waiting lanes", "");
  for (const lane of pending) {
    const after = (lane.after ?? []).map((id) => {
      const other = ledger.lanes[id];
      return `${id} ${other?.status === "closed" ? (other.landed ? "landed" : "closed without landing") : (other?.status ?? "gone")}`;
    });
    lines.push(`- ${lane.id} ${lane.title}: after ${after.join(", ")}${lane.onHold ? `. On hold: ${lane.onHold.reason}` : lane.held ? `. Not open: ${lane.held.why}` : ""}`, ...(copy ? laneAim(lane).map((line) => `  ${line}`) : []));
  }
  if (pending.length > 0) lines.push("");
  if (!laneId) {
    lines.push(...keptLines(ledger, seats, now));
    const slots = Object.values(ledger.slots ?? {});
    if (slots.length > 0) {
      lines.push("## Working copies", "");
      for (const slot of slots) lines.push(`- ${slot.id} ${slot.path}: ${slot.lane ? `lane ${slot.lane}` : slot.task ? `task ${slot.task}` : "free"}`);
      lines.push("");
    }
  }
  const asks = Object.values(ledger.asks).filter((ask) => ask.status === "open" && (laneId ? ask.lane === laneId : true));
  lines.push("## Open asks", "");
  if (asks.length === 0) lines.push("None.");
  for (const ask of asks) {
    const first = ask.text.split(/\r?\n/).find((line) => line.trim()) ?? "";
    lines.push(`- ${ask.id} ${ask.kind} from ${ask.fromRole} ${ask.from} to ${ask.to}, open ${minutes(now, ask.openedAt)} min: ${first.slice(0, 160)}`);
  }
  if (!laneId) {
    lines.push(...questionLines(ledger, now));
    const closed = lanes.filter((lane) => lane.status === "closed").slice(-5);
    if (closed.length > 0) {
      lines.push("", "## Recently closed", "");
      for (const lane of closed) lines.push(`- ${lane.id} ${lane.title} (${lane.branch})`);
    }
  }
  return `${lines.join("\n")}\n`;
}
