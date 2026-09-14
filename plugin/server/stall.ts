import type { Ask } from "./asks.ts";
import { busy } from "./outbox.ts";

export const PARENT_LABEL = "paseo.parent-agent-id";

export type Seat = {
  id: string;
  title: string | null;
  provider: string;
  cwd: string;
  status: string;
  updatedAt: string;
  archivedAt?: string | null;
  labels?: Record<string, string>;
};

export function parentOf(seat: Seat): string | undefined {
  return seat.labels?.[PARENT_LABEL];
}

export function stalledLeads(
  leads: Seat[],
  all: Seat[],
  asks: Ask[],
  now: number,
  idleMs: number,
  flagged: Map<string, string>,
): Seat[] {
  return leads.filter((lead) => {
    if (lead.archivedAt || lead.status !== "idle") return false;
    const since = Date.parse(lead.updatedAt);
    if (!Number.isFinite(since) || now - since < idleMs) return false;
    if (flagged.get(lead.id) === lead.updatedAt) return false;
    if (asks.some((ask) => ask.agentId === lead.id)) return false;
    return !all.some((seat) => parentOf(seat) === lead.id && !seat.archivedAt && busy(seat.status));
  });
}

export function statusText(project: string, leads: Seat[], all: Seat[], asks: Ask[], now: number): string {
  const lines = [`# Status: ${project}`, "", `Updated ${new Date(now).toISOString()}`, "", "## Leads", ""];
  if (leads.length === 0) lines.push("None running.");
  for (const lead of leads) {
    const children = all.filter((seat) => parentOf(seat) === lead.id && !seat.archivedAt);
    const running = children.filter((seat) => busy(seat.status)).length;
    const idle = Math.max(0, Math.round((now - Date.parse(lead.updatedAt)) / 60_000));
    lines.push(`- ${lead.title ?? lead.id} (${lead.id}): ${lead.status}${lead.status === "idle" ? ` ${idle} min` : ""}; seats ${children.length}, running ${running}`);
  }
  lines.push("", "## Open requests", "");
  if (asks.length === 0) lines.push("None.");
  for (const ask of asks) {
    const age = Math.round((now - ask.openedAt) / 60_000);
    lines.push(`- ${ask.kind} from ${ask.title} (${ask.agentId}), open ${age} min: ${ask.text.split(/\r?\n/)[0] ?? ""}`);
  }
  return `${lines.join("\n")}\n`;
}
