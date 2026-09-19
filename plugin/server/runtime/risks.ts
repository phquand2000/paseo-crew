// What a turn DID, read mechanically from its tool calls: destructive commands, weakened tests,
// thrashing, unverified writes, a compaction. It reads no prose and calls no model, so it cannot
// see a Lead changing its mind or a Peer admitting it was wrong — the judgement the concept calls
// attention is the seat above's, and this only hands it something to look at.
import { type Item, type Timeline, turnItems } from "./timeline.ts";
import { DESTRUCTIVE, TEST_PATH } from "./watch/facts.ts";

/** What this reader can find. Open, so a kit can add one without the desk being rebuilt. */
export type Risk = string;


export const ASSERTION = "\\b(assert|expect|should)\\b";

export const SKIPPED = "\\.(skip|only|todo)\\b|\\bx(it|describe|test)\\b|@Disabled\\b|pytest\\.mark\\.skip\\b";

export const WEIGHT: Record<Risk, number> = {
  destructive: 100,
  "test-weakened": 40,
  repetition: 25,
  unverified: 20,
  compaction: 10,
};

export type Reading = { signals: Risk[]; score: number; notes: string[]; record: string[] };

export type ReadOptions = {
  gate?: string;
  recorded?: boolean;
  destructive?: string;
  testPath?: string;
  repeatsAt?: number;
};

type Detail = { type?: string; command?: string; filePath?: string; oldString?: string; newString?: string };

const detailOf = (item: Item): Detail => (item.detail ?? {}) as Detail;

function actions(turn: Item[]): Detail[] {
  const seen = new Set<string>();
  const taken: Detail[] = [];
  for (const item of turn) {
    if (item.type !== "tool_call") continue;
    const id = typeof item.callId === "string" ? item.callId : "";
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    taken.push(detailOf(item));
  }
  return taken;
}

function repeated(values: string[], times: number): string | undefined {
  const seen = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    const count = (seen.get(value) ?? 0) + 1;
    seen.set(value, count);
    if (count >= times) return value;
  }
  return undefined;
}

const count = (text: string, pattern: string): number => (text.match(new RegExp(pattern, "gi")) ?? []).length;

const short = (path: string): string => path.split("/").slice(-2).join("/");

function tally(values: string[]): string[] {
  const seen = new Map<string, number>();
  for (const value of values) if (value) seen.set(value, (seen.get(value) ?? 0) + 1);
  return [...seen.entries()].map(([value, times]) => (times > 1 ? `${value} (${times})` : value));
}

export function read(timeline: Timeline, options: ReadOptions = {}): Reading {
  const { gate, recorded = false, repeatsAt = 3 } = options;
  const destructive = new RegExp(options.destructive ?? DESTRUCTIVE, "i");
  const isTest = new RegExp(options.testPath ?? TEST_PATH, "i");
  const skipped = new RegExp(SKIPPED, "i");

  const turn = turnItems(timeline);
  const details = actions(turn);
  const isGate = (detail: Detail) => detail.type === "shell" && Boolean(gate) && String(detail.command ?? "").includes(gate as string);
  const commands = details.filter((detail) => detail.type === "shell").map((detail) => String(detail.command ?? ""));
  const writes = details.filter((detail) => detail.type === "edit" || detail.type === "write");
  const written = writes.map((detail) => String(detail.filePath ?? ""));

  const signals: Risk[] = [];
  const notes: string[] = [];

  const wrecked = commands.find((command) => destructive.test(command));
  if (wrecked) {
    signals.push("destructive");
    notes.push(`shell: ${wrecked.slice(0, 120)}`);
  }

  // Only the edits. A whole-file write carries no before and after here, so the one thing this signal
  // exists to catch — a test file replaced with one that asserts less — cannot be seen in it at all;
  // what the turn wrote is still in the record below, which is where it has to be read from.
  for (const write of writes.filter((detail) => detail.type === "edit")) {
    const path = String(write.filePath ?? "");
    if (!isTest.test(path)) continue;
    const before = String(write.oldString ?? "");
    const after = String(write.newString ?? "");
    if (!before && !after) continue;
    const lost = count(before, ASSERTION) - count(after, ASSERTION);
    const muted = skipped.test(after) && !skipped.test(before);
    if (lost <= 0 && !muted) continue;
    signals.push("test-weakened");
    notes.push(muted ? `${path} — edit adds a skip marker` : `${path} — edit replaces ${count(before, ASSERTION)} assertions with ${count(after, ASSERTION)}`);
    break;
  }

  const stretches: string[][] = [[]];
  for (const detail of details) {
    if (isGate(detail)) {
      stretches.push([]);
      continue;
    }
    if (detail.type === "edit" || detail.type === "write") stretches[stretches.length - 1]!.push(String(detail.filePath ?? ""));
  }
  const edited = stretches.map((stretch) => repeated(stretch, repeatsAt)).find(Boolean);
  const ran = repeated(
    commands.filter((command) => !(gate && command.includes(gate))),
    repeatsAt,
  );
  if (edited || ran) {
    signals.push("repetition");
    // What each branch really counted: the same file written repeatedly between two runs of the
    // gate, or the same command run repeatedly anywhere in the turn. The note used to claim both
    // were adjacent and gate-free, which neither check establishes.
    notes.push(
      edited
        ? `${edited.slice(0, 120)} — written ${repeatsAt} times between runs of the gate`
        : `${ran!.slice(0, 120)} — run ${repeatsAt} times in this turn, not counting the gate`,
    );
  }

  const ranGate = Boolean(gate) && commands.some((command) => command.includes(gate as string));
  if (recorded && written.length > 0 && gate && !ranGate) {
    signals.push("unverified");
    notes.push(`${written.length} file${written.length === 1 ? "" : "s"} written, ${gate} not run in this turn`);
  }

  if (turn.some((item) => item.type === "compaction")) {
    signals.push("compaction");
    notes.push("context compacted inside this turn");
  }

  const record: string[] = [];
  const reads = details.filter((detail) => detail.type === "read").length;
  if (written.length > 0) record.push(`edited ${tally(written.map(short)).join(", ")}`);
  if (commands.length > 0) record.push(`ran ${tally(commands.map((command) => command.slice(0, 60))).join(", ")}`);
  if (reads > 0) record.push(`read ${reads} file${reads === 1 ? "" : "s"}`);
  if (gate) record.push(`${gate}: ${commands.filter((command) => command.includes(gate)).length} run(s) this turn`);
  if (turn.some((item) => item.type === "compaction")) record.push("context compacted inside this turn");

  const score = signals.reduce((total, signal) => total + (WEIGHT[signal] ?? 0), 0);
  return { signals, score, notes, record };
}
