import type { Ledger } from "./ledger.ts";
import type { Project, ProjectConfig } from "./project.ts";

export type SeatView = {
  id: string;
  title?: string | null;
  provider: string;
  cwd: string;
  status: string;
  updatedAt: string;
  archivedAt?: string | null;
  labels?: Record<string, string>;
  pendingPermissions?: { title?: string; name?: string }[];
};

const minutes = (now: number, at: number | string) => Math.max(0, Math.round((now - (typeof at === "string" ? Date.parse(at) : at)) / 60_000));

function seatLine(seats: Map<string, SeatView>, id: string | undefined, now: number): string {
  if (!id) return "none";
  const seat = seats.get(id);
  if (!seat) return `${id} gone`;
  return seat.status === "idle" ? `${id} idle ${minutes(now, seat.updatedAt)} min` : `${id} ${seat.status}`;
}

export function statusText(project: Project, ledger: Ledger, config: ProjectConfig, seats: Map<string, SeatView>, now: number, laneId?: string, waiting: SeatView[] = []): string {
  const lines = [`# Status: ${project.root}`, "", `Updated ${new Date(now).toISOString()}. Base ${config.base ?? "unset"}. Gate ${config.gate ?? "none"}.`, ""];
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
    lines.push(`## ${lane.id} ${lane.title}`, "", `Branch ${lane.branch} off ${lane.base}. Lead ${seatLine(seats, lane.lead, now)}.`, "");
    const tasks = Object.values(ledger.tasks).filter((task) => task.lane === lane.id);
    if (tasks.length === 0) lines.push("- no tasks yet");
    for (const task of tasks) {
      const detail = ["running", "rework"].includes(task.status) ? `, Peer ${seatLine(seats, task.peer, now)}` : task.handback ? `, hand-back ${minutes(now, task.handback.at)} min ago` : "";
      lines.push(`- ${task.id} ${task.title}: ${task.status}${detail}`);
    }
    lines.push("");
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
