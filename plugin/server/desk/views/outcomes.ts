import { errorText } from "../../core/errors.ts";
import { type Caller, type ToolReply, no, ok } from "../context.ts";
import type { DeskEvent } from "../store/events.ts";
import { recordLines } from "../store/records.ts";

type Stamped = DeskEvent & { at: string };
type Tally = Map<string, Map<string, number>>;

const FOLLOWS: readonly string[] = ["task.reworked", "task.accepted", "task.cut"];
const AFTER = ["reworked", "accepted", "cut", "nothing yet", "on no task"];
const ANSWERS = ["kept", "changed", "no default"];
const ROUNDS = ["with no rework", "after one rework", "after two or more"];

/** What the reviews and asks on record went on to change, counted from the events log; a report, never a verdict. */
export async function readOutcomes(caller: Caller, args: { since?: string }): Promise<ToolReply> {
  const since = args.since ? Date.parse(args.since) : 0;
  if (Number.isNaN(since)) return no(`since is not a date: ${args.since}. Give one like 2026-09-01.`);
  let lines: string[];
  try {
    lines = await recordLines(caller.project.state, "events", since);
  } catch (error) {
    return no(`The events log could not be read: ${errorText(error)}`);
  }
  const events = lines.flatMap((line) => stamped(line, since));
  const period = args.since ? `since ${args.since}` : "over the whole log kept";
  return ok(
    [
      `Outcomes ${period}. Events written before these counts were kept are left out.`,
      "",
      ...reviewLines(events),
      "",
      ...askLines(events),
      "",
      acceptedLine(events),
    ].join("\n"),
  );
}

function stamped(line: string, since: number): Stamped[] {
  try {
    const event = JSON.parse(line) as Stamped;
    return Date.parse(event.at) >= since ? [event] : [];
  } catch {
    // A line cut short by a crash mid-write is not an event.
    return [];
  }
}

function bump(tally: Tally, row: string, ...columns: string[]): void {
  const counts = tally.get(row) ?? new Map<string, number>();
  tally.set(row, counts);
  for (const column of columns) counts.set(column, (counts.get(column) ?? 0) + 1);
}

/** `columns` in order, each with its count, leaving out those at none. */
function spread(counts: Map<string, number>, columns: string[]): string {
  const shown = columns.filter((column) => counts.get(column));
  return shown.map((column) => `${column} ${counts.get(column)}`).join(", ") || "none";
}

/** Each review by its reviewer's role and verdict, and what its Lead did next with the task it read. */
function reviewLines(events: Stamped[]): string[] {
  const follows = new Map<string, { index: number; what: string }[]>();
  events.forEach((event, index) => {
    if (!FOLLOWS.includes(event.kind)) return;
    const task = (event as { task: string }).task;
    follows.set(task, [...(follows.get(task) ?? []), { index, what: event.kind.slice("task.".length) }]);
  });
  const verdicts: Tally = new Map();
  const after: Tally = new Map();
  events.forEach((event, index) => {
    if (event.kind !== "review.done" || event.role === undefined) return;
    const next = event.of
      ? (follows.get(event.of)?.find((step) => step.index > index)?.what ?? "nothing yet")
      : "on no task";
    bump(verdicts, event.role, "all", event.outcome);
    bump(after, event.role, next);
  });
  if (verdicts.size === 0) return ["Reviews: none recorded."];
  return [
    "Reviews by the reviewer's role, and what came next for the task reviewed:",
    ...[...verdicts].map(([role, counts]) => {
      const kinds = [...counts.keys()].filter((key) => key !== "all").sort();
      return `- ${role}: ${counts.get("all")} (${spread(counts, kinds)}); then ${spread(after.get(role)!, AFTER)}`;
    }),
  ];
}

/** Asks by who asked and of what kind: whether the answer kept the asker's default, how many went up, and how long they waited. */
function askLines(events: Stamped[]): string[] {
  const rows = new Map<string, string>();
  const tally: Tally = new Map();
  const opened = new Map<string, number>();
  const waits = new Map<string, number[]>();
  for (const event of events) {
    if (event.kind === "ask.opened" && event.fromRole !== undefined) {
      const row = `${event.fromRole} ${event.askKind}`;
      rows.set(event.ask, row);
      opened.set(event.ask, Date.parse(event.at));
      bump(tally, row, "asked");
    }
    const row = "ask" in event ? rows.get(event.ask) : undefined;
    if (!row) continue;
    if (event.kind !== "ask.answered") continue;
    bump(tally, row, event.kept === null ? "no default" : event.kept ? "kept" : "changed");
    waits.set(row, [...(waits.get(row) ?? []), (Date.parse(event.at) - opened.get(event.ask)!) / 60_000]);
  }
  if (tally.size === 0) return ["Asks: none recorded."];
  return [
    "Asks by who asked and its kind, and whether the answer kept the asker's default:",
    ...[...tally].map(([row, counts]) => {
      const answered = ANSWERS.reduce((sum, column) => sum + (counts.get(column) ?? 0), 0);
      counts.set("open", counts.get("asked")! - answered);
      const wait = waits.has(row) ? `; median wait ${median(waits.get(row)!)} min` : "";
      return `- ${row}: ${counts.get("asked")} (${spread(counts, [...ANSWERS, "open"])})${wait}`;
    }),
  ];
}

/** Accepted tasks by how many times their Lead sent them back first. */
function acceptedLine(events: Stamped[]): string {
  const rounds = new Map<string, number>();
  let accepted = 0;
  for (const event of events) {
    if (event.kind !== "task.accepted") continue;
    accepted += 1;
    const key = ROUNDS[Math.min(event.reworks, ROUNDS.length - 1)]!;
    rounds.set(key, (rounds.get(key) ?? 0) + 1);
  }
  if (accepted === 0) return "Accepted tasks: none recorded.";
  return `Accepted tasks: ${accepted} (${spread(rounds, ROUNDS)}).`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2);
}
