import { no, ok, str } from "../context.ts";
import { type Incident, loadIncidents } from "../incidents.ts";
import { clip } from "../letters.ts";
import type { Tool } from "../services.ts";

const at = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

function line(item: Incident): string {
  const state = item.open ? (item.told !== undefined ? `told ${at(item.told)}` : item.held ? `not sent: ${item.held}` : "open") : `closed${item.label ? `, marked ${item.label}` : ""}`;
  const seen = item.count > 1 ? ` (seen ${item.count} times, last ${at(item.last)})` : "";
  const p = item.p !== undefined ? ` p=${item.p.toFixed(2)}` : "";
  return `- ${item.id} [${item.level}, ${state}] ${item.where}: ${item.kind}${p}${seen} — ${clip(item.quote.replace(/\s+/g, " "), 300)}`;
}

export const incidents: Tool = async ({ ctx }, caller, args) => {
  const held = loadIncidents(caller.project.state);
  const all = Object.values(held.items).sort((a, b) => b.opened - a.opened);
  const open = all.filter((item) => item.open);
  const lines = [open.length > 0 ? `${open.length} open:` : "Nothing open."];
  lines.push(...open.map(line));
  if (args.closed === true) {
    const closed = all.filter((item) => !item.open).slice(0, 20);
    lines.push("", closed.length > 0 ? "Recently closed:" : "Nothing closed yet.", ...closed.map(line));
  }
  if (open.length > 0) lines.push("", "Each is a signal to look at, not a verdict. Mark each one useful or noise with ack once you have looked, so the thresholds can be tuned.");
  ctx.event(caller.project, { kind: "incident.read", agent: caller.id, open: open.length });
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
  return ok(`${id} marked ${verdict} and closed.`);
};
