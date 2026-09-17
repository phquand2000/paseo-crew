import type { SeatView } from "../core/paseo.ts";
import type { Ledger } from "./ledger.ts";
import type { Project, ProjectConfig } from "./project.ts";


const minutes = (now: number, at: number | string) => Math.max(0, Math.round((now - (typeof at === "string" ? Date.parse(at) : at)) / 60_000));

function seatLine(seats: Map<string, SeatView>, id: string | undefined, now: number): string {
  if (!id) return "none";
  const seat = seats.get(id);
  if (!seat) return `${id} gone`;
  return seat.status === "idle" ? `${id} idle ${minutes(now, seat.updatedAt)} min` : `${id} ${seat.status}`;
}

export function statusText(
  project: Project,
  ledger: Ledger,
  config: ProjectConfig,
  seats: Map<string, SeatView>,
  now: number,
  laneId?: string,
  waiting: SeatView[] = [],
  held: { to: string; text: string; at: number }[] = [],
): string {
  const lines = [`# Status: ${project.root}`, "", `Updated ${new Date(now).toISOString()}. Base ${config.base ?? "unset"}. Gate ${config.gate ?? "none"}.`, ""];
  const stranded = held.filter((letter) => !seats.has(letter.to));
  if (stranded.length > 0) {
    lines.push("## Mail with nobody to read it", "", "The seat each of these was addressed to is gone. Nothing is lost; they are held until a seat can take them.", "");
    for (const letter of stranded) {
      const first = letter.text.split(/\r?\n/).find((line) => line.trim()) ?? "";
      lines.push(`- to ${letter.to}, waiting ${minutes(now, letter.at)} min: ${first.slice(0, 160)}`);
    }
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
    lines.push(`## ${lane.id} ${lane.title}`, "", `Branch ${lane.branch} off ${lane.base}. Lead ${seatLine(seats, lane.lead, now)}.${detour}`, "");
    const tasks = Object.values(ledger.tasks).filter((task) => task.lane === lane.id);
    if (tasks.length === 0) lines.push("- no tasks yet");
    for (const task of tasks) {
      const detail = ["running", "rework"].includes(task.status) ? `, Peer ${seatLine(seats, task.peer, now)}` : task.handback ? `, hand-back ${minutes(now, task.handback.at)} min ago` : "";
      lines.push(`- ${task.id} ${task.title}: ${task.status}${detail}`);
    }
    lines.push("");
  }
  if (!laneId) {
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
    const closed = lanes.filter((lane) => lane.status === "closed").slice(-5);
    if (closed.length > 0) {
      lines.push("", "## Recently closed", "");
      for (const lane of closed) lines.push(`- ${lane.id} ${lane.title} (${lane.branch})`);
    }
  }
  return `${lines.join("\n")}\n`;
}
