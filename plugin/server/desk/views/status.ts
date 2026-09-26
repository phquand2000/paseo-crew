import type { Kit } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import type { SeatView } from "../../core/paseo.ts";
import { plural } from "../../core/text.ts";
import { DAY_MS, HOUR_MS, minutesSince } from "../../core/time.ts";
import { AT_WORK } from "../../domain/task.ts";
import { keptCopy, keptPeers } from "../seats/kept.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, ownCopyHolder } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { type LaneHome, type Project, type ProjectConfig, laneHomeFor, loadConfig, projectOf } from "../project.ts";

/** What the status tool read from the project's own checkout; `work` is undefined when git could not say. */
export type OwnCheckout = { branch?: string; head?: string; work?: string[] };

/** A letter the outbox still holds, and when it is given up on. */
type Held = { to: string; text: string; at: number; until: number };

type Seats = Map<string, SeatView>;

const SHOWN_FILES = 10;
const SHOWN_OUTCOME = 300;

const HOMES: Record<LaneHome, string> = {
  onBranch: "carrying on the branch this copy is on",
  newBranch: "on a new branch off the base in this copy",
  isolate: "in a copy of their own",
};

const left = (ms: number) =>
  ms > DAY_MS ? `${Math.ceil(ms / DAY_MS)} days` : `${Math.max(1, Math.ceil(ms / HOUR_MS))} h`;
const opening = (text: string) => text.split(/\r?\n/).find((line) => line.trim()) ?? "";

/** To the minute, like every age on the page: a status asked again within it reads the same when nothing moved. */
const stamp = (now: number): string => `${new Date(now).toISOString().slice(0, 16)}Z`;

/** The whole project's page, as the panel shows it and status.md keeps it: supervisors waiting on the Human included. */
export function statusPage(kit: Kit, project: Project, seats: Seats, now: number, held: Held[]): string {
  const waiting = [...seats.values()].filter(
    (seat) =>
      can(seatOf(kit, seat.provider)?.role, "supervise") &&
      projectOf(seat.cwd).slug === project.slug &&
      (seat.pendingPermissions?.length ?? 0) > 0,
  );
  return statusText(project, loadLedger(project.state), loadConfig(project.state), seats, now, { waiting, held });
}

/** The status page: the whole project, or one lane when `laneId` names it; `copy` adds the project's own checkout. */
export function statusText(
  project: Project,
  ledger: Ledger,
  config: ProjectConfig,
  seats: Seats,
  now: number,
  {
    laneId,
    waiting = [],
    held = [],
    copy,
  }: { laneId?: string; waiting?: SeatView[]; held?: Held[]; copy?: OwnCheckout } = {},
): string {
  const lanes = Object.values(ledger.lanes).filter((lane) => (laneId ? lane.id === laneId : true));
  const open = lanes.filter((lane) => lane.status === "open");
  const pending = lanes.filter((lane) => lane.status === "waiting");
  const lines = [
    ...heading(project, config, now),
    ...(copy ? ownCopyLines(project, ledger, config, copy) : []),
    ...mailLines(project, ledger, seats, now, held),
    ...waitingOnHuman(waiting),
    ...(open.length === 0
      ? ["No open lanes.", ""]
      : open.flatMap((lane) => openLaneLines(ledger, lane, seats, now, copy))),
    ...waitingLaneLines(ledger, pending, copy),
    ...(laneId ? [] : [...keptLines(ledger, seats, now), ...copyLines(ledger)]),
    ...askLines(ledger, now, laneId),
    ...(laneId ? [] : [...questionLines(ledger, now), ...closedLines(lanes)]),
  ];
  return `${lines.join("\n")}\n`;
}

/** How the project is set up, the Human's standing orders included. */
function heading(project: Project, config: ProjectConfig, now: number): string[] {
  const gate = config.gate || (config.gate === "" ? "none, by this project's own choice" : "none");
  const asked =
    config.askFirst.length > 0
      ? `A landing that touches ${config.askFirst.join(", ")} waits for the Human (askFirst).`
      : "No landing waits for the Human (askFirst is empty).";
  const rules = config.riskRules ? `Risk rules of its own: ${config.riskRules.length}.` : "The kit's risk rules.";
  const setup = `Updated ${stamp(now)}. Base ${config.base ?? "unset"}. Gate ${gate}. Lanes land as ${config.landAs}.`;
  return [`# Status: ${project.root}`, "", `${setup} ${asked} ${rules}`, ""];
}

/** Names a choice for the Human only where one is real: uncommitted work, or a branch not the base, with no lane in the copy. */
function ownCopyLines(project: Project, ledger: Ledger, config: ProjectConfig, copy: OwnCheckout): string[] {
  const at = copy.branch ? `on ${copy.branch}` : `not on a branch (detached at ${copy.head ?? "an unknown commit"})`;
  const work = copy.work ? [...copy.work].sort() : undefined;
  const more = work && work.length > SHOWN_FILES ? `, and ${work.length - SHOWN_FILES} more` : "";
  const files = work ? `${work.length} uncommitted ${plural(work.length, "file", "files")}` : "";
  const state = !work
    ? "and git could not say what is uncommitted"
    : work.length === 0
      ? "clean"
      : `with ${files}: ${work.slice(0, SHOWN_FILES).join(", ")}${more}`;
  const holder = ownCopyHolder(Object.values(ledger.lanes));
  const held =
    holder?.status === "open"
      ? `Lane ${holder.id} is working in it.`
      : holder
        ? `Lane ${holder.id} is closed, and its Lead is ending a turn in it; it goes back to ${holder.base} after.`
        : "No lane is working in it.";
  const lines = ["## The project's own copy", "", `${project.root} is ${at}, ${state}.`, held];
  if (config.laneHome)
    lines.push(`Lanes open ${HOMES[config.laneHome]}, as the Human chose for every lane (laneHome).`);
  const home = holder ? undefined : laneHomeFor(undefined, config, copy.branch, work);
  if (typeof home === "object")
    lines.push(`The Human decides where the next lane works, before it opens: ${home.question}.`);
  return [...lines, ""];
}

/** Mail the outbox holds for this project: for seats gone, which nobody else is sent, and for seats that have not taken it. */
function mailLines(project: Project, ledger: Ledger, seats: Seats, now: number, held: Held[]): string[] {
  // One outbox holds every project's mail: a seated recipient belongs to its copy's project, a gone one to this project's record.
  const mine = held.filter((letter) => {
    const seat = seats.get(letter.to);
    return seat ? Boolean(seat.cwd) && projectOf(seat.cwd).slug === project.slug : Boolean(ledger.agents[letter.to]);
  });
  const stranded = mine.filter((letter) => !seats.has(letter.to));
  const queued = mine.filter((letter) => seats.has(letter.to));
  const lines: string[] = [];
  if (stranded.length > 0) {
    const intro =
      "The seat each of these was addressed to is gone, and no other seat is sent them: pass on what still matters before each is given up on.";
    lines.push("## Mail with nobody to read it", "", intro, "");
    for (const letter of stranded) {
      const age = `waiting ${minutesSince(now, letter.at)} min, given up on in ${left(letter.until - now)}`;
      lines.push(`- to ${letter.to}, ${age}: ${opening(letter.text).slice(0, 160)}`);
    }
    lines.push("");
  }
  // Held for a seat that is there but has not taken it: this is where a letter going nowhere shows.
  if (queued.length > 0) {
    lines.push("## Mail waiting to be taken", "", "The seat is there and has not read these yet.", "");
    for (const letter of queued)
      lines.push(
        `- to ${letter.to}, waiting ${minutesSince(now, letter.at)} min (${seats.get(letter.to)?.status ?? "unknown"})`,
      );
    lines.push("");
  }
  return lines;
}

function waitingOnHuman(waiting: SeatView[]): string[] {
  if (waiting.length === 0) return [];
  const asked = (seat: SeatView) =>
    (seat.pendingPermissions ?? []).map((request) => request.title ?? request.name ?? "a request").join("; ");
  return [
    "## Waiting on the Human",
    "",
    ...waiting.map((seat) => `- ${seat.title ?? seat.id} (${seat.id}): ${asked(seat)}`),
    "",
  ];
}

function openLaneLines(ledger: Ledger, lane: Lane, seats: Seats, now: number, copy: OwnCheckout | undefined): string[] {
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
    ...(copy ? laneAim(lane) : []),
    "",
    ...(tasks.length === 0 ? ["- no tasks yet"] : taskLines),
    "",
  ];
}

function waitingLaneLines(ledger: Ledger, pending: Lane[], copy: OwnCheckout | undefined): string[] {
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
    if (copy) lines.push(...laneAim(lane).map((line) => `  ${line}`));
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

function seatLine(seats: Seats, id: string | undefined, now: number): string {
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

/** Leads kept after their lane closed, for whoever supervises to release: how long each has sat idle, and the copy it holds. */
function keptLines(ledger: Ledger, seats: Seats, now: number): string[] {
  const kept = Object.values(ledger.lanes).filter(
    (lane) =>
      lane.status === "closed" && lane.lead && seats.has(lane.lead) && ledger.agents[lane.lead]?.lane === lane.id,
  );
  if (kept.length === 0) return [];
  const line = (lane: Lane) => {
    const copy = keptCopy(ledger, lane) ? `, in ${lane.slot}` : "";
    const how = lane.landed ? "landed" : "dropped";
    return `- ${lane.id} ${lane.title}, ${how}: Lead ${seatLine(seats, lane.lead, now)}${copy}. release lane ${lane.id} once its work is done or the Human asks.`;
  };
  return ["## Kept Leads", "", ...kept.map(line), ""];
}

function copyLines(ledger: Ledger): string[] {
  const slots = Object.values(ledger.slots);
  if (slots.length === 0) return [];
  const holder = (slot: (typeof slots)[number]) =>
    slot.lane ? `lane ${slot.lane}` : slot.task ? `task ${slot.task}` : "free";
  return ["## Working copies", "", ...slots.map((slot) => `- ${slot.id} ${slot.path}: ${holder(slot)}`), ""];
}

function askLines(ledger: Ledger, now: number, laneId: string | undefined): string[] {
  const asks = Object.values(ledger.asks).filter(
    (ask) => ask.status === "open" && (laneId ? ask.lane === laneId : true),
  );
  const line = (ask: (typeof asks)[number]) =>
    `- ${ask.id} ${ask.kind} from ${ask.fromRole} ${ask.from} to ${ask.to}, open ${minutesSince(now, ask.openedAt)} min: ${opening(ask.text).slice(0, 160)}`;
  return ["## Open asks", "", ...(asks.length === 0 ? ["None."] : asks.map(line))];
}

/** The questions still before the Human, each with what goes ahead while they are silent. */
function questionLines(ledger: Ledger, now: number): string[] {
  const open = Object.values(ledger.questions).filter((question) => question.status === "open");
  if (open.length === 0) return [];
  const line = (question: (typeof open)[number]) => {
    const where = `${question.class}${question.lane ? `, ${question.lane}` : ""}`;
    const ask = question.question.slice(0, 160);
    return `- ${question.id} (${where}), open ${minutesSince(now, question.openedAt)} min: ${ask} Recommended: ${question.recommend}. While silent: ${question.ifSilent.slice(0, 160)}`;
  };
  return ["", "## Questions for the Human", "", ...open.map(line)];
}

function closedLines(lanes: Lane[]): string[] {
  const closed = lanes.filter((lane) => lane.status === "closed").slice(-5);
  if (closed.length === 0) return [];
  return ["", "## Recently closed", "", ...closed.map((lane) => `- ${lane.id} ${lane.title} (${lane.branch})`)];
}
