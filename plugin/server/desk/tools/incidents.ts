import { z } from "zod";
import { can } from "../../catalog/kit.ts";
import type { Held } from "../../domain/incident.ts";
import { type Caller, no, ok } from "../context.ts";
import { type Incident, incidentsFault, loadIncidents } from "../incidents.ts";
import { laneOfLead, loadLedger } from "../ledger.ts";
import { clip } from "../../core/text.ts";
import { defineTool } from "../services.ts";

export const at = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

const HELD: Record<Held, string> = {
  shadow: "shadow",
  probation: "most of its kind's last ten marks were noise",
  budget: "its lane's limit for today is reached",
  nobody: "nobody was seated to tell",
};

function line(item: Incident): string {
  const sent = item.told !== undefined ? `told ${at(item.told)}` : item.held ? `not sent: ${HELD[item.held]}` : "";
  const state = item.open ? sent || "open" : ["closed", sent, item.label ? `marked ${item.label}` : "not marked"].filter(Boolean).join(", ");
  const seen = item.count > 1 ? ` (seen ${item.count} times, last ${at(item.last)})` : "";
  const later = item.later !== undefined ? `; seen after you were told: ${clip(item.later.replace(/\s+/g, " "), 200)}` : "";
  return `- ${item.id} [${item.level}, ${state}] ${item.where}, agent ${item.seat}: ${item.kind}${seen} — ${clip(item.quote.replace(/\s+/g, " "), 300)}${later}`;
}

function briefs(state: string, shown: Incident[]): string[] {
  let ledger;
  try {
    ledger = loadLedger(state);
  } catch {
    return [];
  }
  const text = (value: string, limit: number) => clip(value.replace(/\s+/g, " "), limit);
  const out: string[] = [];
  for (const id of [...new Set(shown.flatMap((item) => (item.task ? [item.task] : [])))]) {
    const task = ledger.tasks[id];
    if (task) out.push(`- ${task.id} ${text(task.title, 120)}: goal ${text(task.goal, 300)}; acceptance ${text(task.acceptance.join("; "), 300)}; owned ${text(task.owned.join(", ") || "not declared", 200)}; out of scope ${text(task.outOfScope.join("; ") || "nothing named", 200)}`);
  }
  for (const id of [...new Set(shown.flatMap((item) => (item.lane && !item.task ? [item.lane] : [])))]) {
    const lane = ledger.lanes[id];
    if (lane) out.push(`- ${lane.id} ${text(lane.title, 120)}: outcome ${text(lane.outcome, 300)}; acceptance ${text(lane.acceptance.join("; "), 300)}; out of scope ${text(lane.outOfScope.join("; ") || "nothing named", 200)}`);
  }
  return out.length > 0 ? ["", "What they were asked:", ...out] : [];
}

/** A supervisor sees every incident; a Lead only those about its own open lane's other seats, never itself. */
export function mine(caller: Caller): ((item: Incident) => boolean) | string {
  if (can(caller.role, "supervise")) return () => true;
  let lane: string | undefined;
  try {
    lane = laneOfLead(loadLedger(caller.project.state), caller.id)?.id;
  } catch {}
  if (!lane) return "You have no open lane, so there are no incidents here for you.";
  return (item) => item.lane === lane && item.seat !== caller.id;
}

export const incidents = defineTool({
  name: "incidents",
  input: z.strictObject({ closed: z.boolean().optional() }),
  async handle({ ctx }, caller, args) {
    const fault = incidentsFault(caller.project.state);
    if (fault) return no(`${fault}. Only the Human can repair it or move it aside.`);
    const allowed = mine(caller);
    if (typeof allowed === "string") return no(allowed);
    const held = loadIncidents(caller.project.state);
    const all = Object.values(held.items).filter(allowed);
    const waiting = all.filter((item) => item.open || !item.label).sort((a, b) => b.last - a.last);
    const shown = waiting.slice(0, 50);
    const lines = [waiting.length > 0 ? `${waiting.length} not yet marked:` : "Nothing waiting to be marked."];
    lines.push(...shown.map(line));
    if (waiting.length > shown.length) lines.push(`… and ${waiting.length - shown.length} older ones not shown.`);
    lines.push(...briefs(caller.project.state, shown));
    if (args.closed === true) {
      const marked = all.filter((item) => item.label).sort((a, b) => (b.closed ?? b.last) - (a.closed ?? a.last)).slice(0, 20);
      lines.push("", marked.length > 0 ? "Recently marked:" : "Nothing marked yet.", ...marked.map(line));
    }
    if (waiting.length > 0) lines.push("", "Each is a signal to look at, not a verdict. Mark each one with mark_incident once you have looked at the agent's record, so the thresholds can be tuned.");
    ctx.event(caller.project, { kind: "incident.read", agent: caller.id, waiting: waiting.length });
    return ok(lines.join("\n"));
  },
});
