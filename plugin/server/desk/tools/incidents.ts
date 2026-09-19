import { no, ok, str } from "../context.ts";
import { type Incident, incidentsFault, loadIncidents } from "../incidents.ts";
import { clip } from "../letters.ts";
import type { Tool } from "../services.ts";

const at = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

function line(item: Incident): string {
  const sent = item.told !== undefined ? `told ${at(item.told)}` : item.held ? `not sent: ${item.held}` : "";
  const state = item.open ? sent || "open" : ["closed", sent, item.label ? `marked ${item.label}` : "not marked"].filter(Boolean).join(", ");
  const seen = item.count > 1 ? ` (seen ${item.count} times, last ${at(item.last)})` : "";
  const p = item.p !== undefined ? ` p=${item.p.toFixed(2)}` : "";
  return `- ${item.id} [${item.level}, ${state}] ${item.where}, agent ${item.seat}: ${item.kind}${p}${seen} — ${clip(item.quote.replace(/\s+/g, " "), 300)}`;
}

export const incidents: Tool = async ({ ctx }, caller, args) => {
  const fault = incidentsFault(caller.project.state);
  if (fault) return no(`${fault}. Only the Human can repair it or move it aside.`);
  const held = loadIncidents(caller.project.state);
  const all = Object.values(held.items);
  const waiting = all.filter((item) => item.open || !item.label).sort((a, b) => b.last - a.last);
  const shown = waiting.slice(0, 50);
  const lines = [waiting.length > 0 ? `${waiting.length} not yet marked:` : "Nothing waiting to be marked."];
  lines.push(...shown.map(line));
  if (waiting.length > shown.length) lines.push(`… and ${waiting.length - shown.length} older ones not shown.`);
  if (args.closed === true) {
    const marked = all.filter((item) => item.label).sort((a, b) => (b.closed ?? b.last) - (a.closed ?? a.last)).slice(0, 20);
    lines.push("", marked.length > 0 ? "Recently marked:" : "Nothing marked yet.", ...marked.map(line));
  }
  if (waiting.length > 0) lines.push("", "Each is a signal to look at, not a verdict. Mark each one useful or noise with ack once you have looked, so the thresholds can be tuned.");
  ctx.event(caller.project, { kind: "incident.read", agent: caller.id, waiting: waiting.length });
  return ok(lines.join("\n"));
};

export const ack: Tool = async ({ ctx }, caller, args) => {
  const id = str(args.id);
  const verdict = str(args.verdict);
  if (!id) return no("ack needs the id of an incident, as incidents lists it.");
  if (verdict !== "useful" && verdict !== "noise") return no("ack needs a verdict: useful, if it was worth your attention, or noise, if it was not.");
  const note = str(args.note);
  const now = Date.now();
  const done = await ctx.incidents(caller.project, (held) => {
    const item = held.items[id];
    if (!item) return undefined;
    item.label = verdict;
    item.ackedBy = caller.id;
    if (note) item.note = note;
    if (item.open) {
      item.open = false;
      item.closed = now;
    }
    return { ...item };
  });
  if (!done) return no(`There is no incident ${id} in this project. incidents lists the ones there are.`);
  ctx.event(caller.project, { kind: "incident.ack", id, agent: caller.id, verdict, note: note || null });
  const later = done.told !== undefined && done.last > done.told ? ` It was seen ${done.count} times, the last at ${at(done.last)} after you were told: ${clip(done.quote.replace(/\s+/g, " "), 200)}` : "";
  return ok(`${id} marked ${verdict} and closed.${later}`);
};
