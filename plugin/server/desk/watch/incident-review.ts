import { can } from "../../catalog/roles.ts";
import { mask } from "../../core/mask.ts";
import { clip } from "../../core/text.ts";
import { type Held, close } from "../../domain/incident.ts";
import { type Caller, type ToolReply, no, ok, str } from "../context.ts";
import { type Incident, readIncidentsFile } from "../incidents.ts";
import { laneOfLead, loadLedger } from "../ledger.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";

type Verdict = NonNullable<Incident["label"]>;

const at = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

const HELD: Record<Held, string> = {
  shadow: "shadow",
  probation: "most of its kind's last ten marks were noise",
  budget: "its lane's limit for today is reached",
  nobody: "nobody was seated to tell",
};

function line(item: Incident): string {
  const sent = item.told !== undefined ? `told ${at(item.told)}` : item.held ? `not sent: ${HELD[item.held]}` : "";
  const state = item.open
    ? sent || "open"
    : ["closed", sent, item.label ? `marked ${item.label}` : "not marked"].filter(Boolean).join(", ");
  const seen = item.count > 1 ? ` (seen ${item.count} times, last ${at(item.last)})` : "";
  const later =
    item.later !== undefined ? `; seen after you were told: ${clip(item.later.replace(/\s+/g, " "), 200)}` : "";
  return `- ${item.id} [${item.level}, ${state}] ${item.where}, agent ${item.seat}: ${item.kind}${seen} — ${clip(item.quote.replace(/\s+/g, " "), 300)}${later}`;
}

function briefs(state: string, shown: Incident[]): string[] {
  let ledger;
  try {
    ledger = loadLedger(state);
  } catch {
    // What they were asked is context, not the list: an unreadable ledger leaves it out.
    return [];
  }
  const text = (value: string, limit: number) => clip(value.replace(/\s+/g, " "), limit);
  const out: string[] = [];
  for (const id of [...new Set(shown.flatMap((item) => (item.task ? [item.task] : [])))]) {
    const task = ledger.tasks[id];
    if (task)
      out.push(
        `- ${task.id} ${text(task.title, 120)}: goal ${text(task.goal, 300)}; acceptance ${text(task.acceptance.join("; "), 300)}; ${task.holds.length > 0 ? `holds ${text(task.holds.join(", "), 200)}` : `hints ${text(task.hints.join(", ") || "none", 200)}`}; out of scope ${text(task.outOfScope.join("; ") || "nothing named", 200)}`,
      );
  }
  for (const id of [...new Set(shown.flatMap((item) => (item.lane && !item.task ? [item.lane] : [])))]) {
    const lane = ledger.lanes[id];
    if (lane)
      out.push(
        `- ${lane.id} ${text(lane.title, 120)}: outcome ${text(lane.outcome, 300)}; acceptance ${text(lane.acceptance.join("; "), 300)}; out of scope ${text(lane.outOfScope.join("; ") || "nothing named", 200)}`,
      );
  }
  return out.length > 0 ? ["", "What they were asked:", ...out] : [];
}

/** A supervisor sees every incident; a Lead only those about its own open lane's other seats, never itself. */
function mine(caller: Caller): ((item: Incident) => boolean) | string {
  if (can(caller.role, "supervise")) return () => true;
  let lane: string | undefined;
  try {
    lane = laneOfLead(loadLedger(caller.project.state), caller.id)?.id;
  } catch {
    // An unreadable ledger names no lane of the caller's; the refusal below says so.
  }
  if (!lane) return "You have no open lane, so there are no incidents here for you.";
  return (item) => item.lane === lane && item.seat !== caller.id;
}

/** The incidents the caller may mark, newest first, with what the seats they are about were asked. */
export function listIncidents(caller: Caller, withClosed: boolean): ToolReply {
  const read = readIncidentsFile(caller.project.state);
  if ("fault" in read) return no(`${read.fault}. Only the Human can repair it or move it aside.`);
  const allowed = mine(caller);
  if (typeof allowed === "string") return no(allowed);
  const all = Object.values(read.incidents.items).filter(allowed);
  const waiting = all.filter((item) => item.open || !item.label).sort((a, b) => b.last - a.last);
  const shown = waiting.slice(0, 50);
  const lines = [waiting.length > 0 ? `${waiting.length} not yet marked:` : "Nothing waiting to be marked."];
  lines.push(...shown.map(line));
  if (waiting.length > shown.length) lines.push(`… and ${waiting.length - shown.length} older ones not shown.`);
  lines.push(...briefs(caller.project.state, shown));
  if (withClosed) {
    const marked = all
      .filter((item) => item.label)
      .sort((a, b) => (b.closed ?? b.last) - (a.closed ?? a.last))
      .slice(0, 20);
    lines.push("", marked.length > 0 ? "Recently marked:" : "Nothing marked yet.", ...marked.map(line));
  }
  if (waiting.length > 0)
    lines.push(
      "",
      "Each is a signal to look at, not a verdict. Mark each one with mark_incident once you have looked at the agent's record, so the thresholds can be tuned.",
    );
  recordEvent(caller.project, { kind: "incident.read", agent: caller.id, waiting: waiting.length });
  return ok(lines.join("\n"));
}

/** Marks an incident the caller may see as useful, noise or unknown, and closes it: the marks tune the thresholds. */
export function markIncident(
  { incidents }: Pick<DeskServices, "incidents">,
  caller: Caller,
  marked: { id: string; verdict: Verdict; note?: string },
): ToolReply {
  const id = str(marked.id);
  const { verdict } = marked;
  const note = mask(str(marked.note));
  const now = Date.now();
  const allowed = mine(caller);
  if (typeof allowed === "string") return no(allowed);
  const done = incidents.transact(caller.project, (held) => {
    const item = held.items[id];
    if (!item || !allowed(item)) return undefined;
    item.label = verdict;
    if (note) item.note = note;
    close(item, now);
    return { ...item };
  });
  if (!done) return no(`There is no incident ${id} here for you to mark. incidents lists the ones there are.`);
  recordEvent(caller.project, {
    kind: "incident.ack",
    id,
    agent: caller.id,
    verdict,
    note: note || null,
    seat: done.seat,
    finding: done.kind,
    opened: done.opened,
    last: done.last,
  });
  const later =
    done.later !== undefined
      ? ` It was seen ${done.count} times, the last at ${at(done.last)} after you were told: ${clip(done.later.replace(/\s+/g, " "), 200)}`
      : "";
  return ok(`${id} marked ${verdict} and closed.${later}`);
}
