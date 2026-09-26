import { isAbsolute, relative } from "node:path";
import { weakened } from "../../catalog/kit/patterns.ts";
import { covers, normalize } from "../../core/scope.ts";
import { oneLine } from "../../core/text.ts";
import type { Level } from "../../domain/incident.ts";
import type { Call, Unit, Window } from "./window.ts";


/** Every fact the code raises and its level; one that can open an incident has the title a person reads it by. */
export const FACTS = {
  destructive: { level: "page", title: "Ran a command that cannot be undone" },
  stuck: { level: "attend", title: "Going round in circles" },
  "no-recovery": { level: "attend", title: "Did not recover from a failure" },
  "test-weakened": { level: "attend", title: "A test lost its assertions" },
  suppressed: { level: "attend", title: "Silenced a check instead of fixing it" },
  unverified: { level: "attend", title: "Handed back without running the gate" },
  "claim-contradicted": { level: "attend", title: "Handed back as complete while its last check failed" },
  "long-turn": { level: "attend", title: "A turn running far longer than usual" },
  "rework-loop": { level: "attend", title: "Sent back again and again" },
  "patched-not-fixed": { level: "attend", title: "Several tasks patched, none fixed" },
  "accepted-unfinished": { level: "attend", title: "Work taken in unfinished" },
  "reviews-unconverged": { level: "attend", title: "Reviews piling up with nothing accepted" },
  "certainty-only": { level: "attend", title: "A review told to report only certainties" },
  "brief-prewritten": { level: "attend", title: "A brief that writes the answer out" },
  "call-failed": { level: "note" },
  "gate-failed": { level: "note" },
  "outside-scope": { level: "note" },
  "edit-before-look": { level: "note" },
} as const satisfies Record<string, { level: "note" } | { level: Exclude<Level, "note">; title: string }>;

export type FactKind = keyof typeof FACTS;

export type Fact = { kind: FactKind; level: Level; quote: string };

export const fact = (kind: FactKind, quote: string): Fact => ({ kind, level: FACTS[kind].level, quote });

/** The title of a kind the incident book holds, which may be one this code no longer raises. */
export function factTitle(kind: string): string | undefined {
  return (FACTS as Record<string, { title?: string }>)[kind]?.title;
}

/** `skipped` and `assertion` are global, since they are counted; `runners` are the commands whose first word says little. */
export type Rules = {
  destructive: RegExp;
  testPath: RegExp;
  suppressed: RegExp;
  skipped: RegExp;
  assertion: RegExp;
  runners: Set<string>;
  desk?: (call: Call) => boolean;
  gates: string[];
  cwd?: string;
  temp?: string;
  /** What the seat writes inside: a parallel task's holds, or its lane's write set; empty or none is anywhere in its copy. */
  scope?: string[];
  repeatsAt: number;
  recoverWithin: number;
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Calls to `server`: read from the field the harness records it in, or else from the name, `pattern` holding `{server}` where it goes. */
export function callsTo(pattern: string | undefined, field: string | undefined, server: string): ((call: Call) => boolean) | undefined {
  if (field) return (call) => field.split(".").reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], call.detail) === server;
  const name = pattern ? new RegExp(pattern.replaceAll("{server}", server)) : undefined;
  return name && ((call) => name.test(call.name));
}

function failed(call: Call): boolean {
  return call.status === "failed" || (typeof call.detail.exitCode === "number" && call.detail.exitCode !== 0);
}

function isGate(call: Call, gates: string[]): boolean {
  return call.detail.type === "shell" && gates.some((gate) => str(call.detail.command).includes(gate));
}

const said = (value: unknown): boolean => value !== undefined && value !== null && value !== "" && !(typeof value === "object" && Object.keys(value).length === 0);

/** Undefined when nothing tells calls apart: Paseo records a Claude seat's MCP calls with an empty input. */
function actionOf(call: Call): string | undefined {
  const { output: _output, exitCode: _exit, ...rest } = call.detail;
  return Object.entries(rest).some(([key, value]) => key !== "type" && said(value)) ? `${call.name}\n${JSON.stringify(rest)}` : undefined;
}

function resultOf(call: Call): string {
  return `${failed(call) ? "failed" : "ok"}\n${str(call.detail.output)}\n${JSON.stringify(call.error ?? null)}`;
}

export function stuck(units: Unit[], rules: Pick<Rules, "repeatsAt">): string | undefined {
  const recent = units.slice(-20);
  const calls = recent.flatMap((unit) => (unit.kind === "call" && unit.call.ended && !unit.call.pseudo ? [unit.call] : []));
  const same = (list: (string | undefined)[]) => list[0] !== undefined && list.every((value) => value === list[0]);
  const n = rules.repeatsAt;
  const tail = calls.slice(-(n + 1));
  if (tail.length === n + 1 && same(tail.map(actionOf)) && same(tail.map((call) => resultOf(call)))) {
    return `the same action with the same result ${n + 1} times: ${oneLine(describe(tail[0]!), 120)}`;
  }
  const errors = calls.slice(-n);
  if (errors.length === n && same(errors.map(actionOf)) && errors.every((call) => failed(call))) {
    return `the same action failing ${n} times: ${oneLine(describe(errors[0]!), 120)}`;
  }
  const spoken = recent.filter((unit) => unit.kind !== "thought");
  for (const said of [spoken.slice(-n), spoken.slice(-n - 1, -1)]) {
    if (said.length === n && said.every((unit) => unit.kind === "said") && same(said.map((unit) => (unit.kind === "said" ? oneLine(unit.text, 2000) : "")))) {
      return `the same words ${n} times with nothing done between them`;
    }
  }
  const cycle = calls.slice(-2 * n);
  if (cycle.length === 2 * n) {
    const actions = cycle.map(actionOf);
    const results = cycle.map((call) => resultOf(call));
    const alternates = actions[0] !== actions[1] && actions.every((action, index) => action === actions[index % 2]) && results.every((result, index) => result === results[index % 2]);
    if (alternates) return `alternating between two actions ${n} times: ${oneLine(describe(cycle[0]!), 60)} / ${oneLine(describe(cycle[1]!), 60)}`;
  }
  return undefined;
}

function describe(call: Call): string {
  const detail = call.detail;
  const what = str(detail.command) || str(detail.filePath) || str(detail.url) || str(detail.query);
  return [call.name || "tool", what].filter(Boolean).join(": ");
}

function escapes(path: string, rules: Rules): boolean {
  if (!path || !rules.cwd || !isAbsolute(path)) return false;
  return relative(rules.cwd, path).startsWith("..");
}

function outside(path: string, rules: Rules): boolean {
  if (!path || /\s/.test(path) || !rules.cwd) return false;
  const rel = isAbsolute(path) ? relative(rules.cwd, path) : normalize(path);
  // The temp directory is scratch only outside the copy: a copy that lies in it is still read by its scope.
  if (rel.startsWith("..")) return !(rules.temp && isAbsolute(path) && !relative(rules.temp, path).startsWith(".."));
  return rules.scope !== undefined && rules.scope.length > 0 && !covers(rules.scope, rel);
}

const PROSE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;

const TRUNCATED = /^\.\.\.\[truncated \d+ chars\]$/;

function sides(detail: Call["detail"], known?: (path: string) => string | undefined): [string, string] | undefined {
  const diff = str(detail.unifiedDiff);
  if (diff) {
    let lines = diff.split("\n");
    if (TRUNCATED.test(lines.at(-1) ?? "")) {
      lines = lines.slice(0, -1);
      while (lines.length > 0 && !/^( |@@)/.test(lines.at(-1)!)) lines.pop();
    }
    const numbered = !lines.some((line) => line.startsWith("@@") || line.startsWith("diff --git")) && lines.some((line) => /^[+-]\s*\d+ /.test(line));
    const header = new Set<number>();
    let hunk = false;
    lines.forEach((line, index) => {
      if (line.startsWith("diff --git")) hunk = false;
      else if (line.startsWith("@@")) hunk = true;
      else if (!hunk && line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) header.add(index).add(index + 1);
    });
    const taken = (sign: string) =>
      lines
        .filter((line, index) => line.startsWith(sign) && !header.has(index))
        .map((line) => (numbered ? line.slice(1).replace(/^\s*\d+ /, "") : line.slice(1)))
        .join("\n");
    return [taken("-"), taken("+")];
  }
  if (detail.type === "write") {
    const before = known?.(str(detail.filePath));
    return before === undefined ? undefined : [before, str(detail.content)];
  }
  return [str(detail.oldString), str(detail.newString)];
}

function hits(text: string, pattern: RegExp): string[] {
  return text.match(new RegExp(pattern.source, "gi")) ?? [];
}

export function onSettle(call: Call, rules: Rules, known?: (path: string) => string | undefined): Fact[] {
  const facts: Fact[] = [];
  const detail = call.detail;
  const bad = failed(call);
  // The desk's refusals already told the seat why and what instead, and the desk records them.
  if (bad && !rules.desk?.(call)) facts.push(fact(isGate(call, rules.gates) ? "gate-failed" : "call-failed", oneLine(describe(call))));
  const writes = detail.type === "edit" || detail.type === "write";
  const both = writes && !bad ? sides(detail, known) : undefined;
  if (both) {
    const path = str(detail.filePath);
    const [before, after] = both;
    if (rules.testPath.test(path) && (before || after)) {
      const how = weakened(before, after, rules);
      if (how) facts.push(fact("test-weakened", `${oneLine(path)}: ${how}`));
    }
    if (!PROSE.test(path)) {
      const was = hits(before, rules.suppressed);
      const now = hits(after, rules.suppressed);
      const added = now.find((hit) => now.filter((other) => other === hit).length > was.filter((other) => other === hit).length);
      if (added) facts.push(fact("suppressed", `${oneLine(path)}: adds ${oneLine(added, 60)}`));
    }
  }
  if (writes && outside(str(detail.filePath), rules)) {
    facts.push(fact("outside-scope", oneLine(str(detail.filePath))));
  }
  return facts;
}

function head(command: string, runners: Set<string>): string {
  const main = command.split(/&&|;/).map((part) => part.trim()).filter((part) => part && !/^cd\s/.test(part)).at(-1) ?? command;
  const words = main.split("|")[0]!.trim().split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  if (!runners.has(words[0] ?? "")) return words[0] ?? "";
  return words.slice(0, /^(run|exec|-m|x|dlx)$/.test(words[1] ?? "") ? 3 : 2).join(" ");
}

export class Recovery {
  private open: { command: string; head: string; steps: number; told: boolean } | undefined;

  step(call: Call, rules: Rules): Fact[] {
    const shell = call.detail.type === "shell";
    const command = str(call.detail.command);
    const bad = failed(call);
    if (shell && bad && (!this.open || head(command, rules.runners) !== this.open.head)) {
      this.open = { command, head: head(command, rules.runners), steps: 0, told: false };
      return [];
    }
    if (!this.open) return [];
    if (shell && !bad && (head(command, rules.runners) === this.open.head || isGate(call, rules.gates))) {
      this.open = undefined;
      return [];
    }
    this.open.steps += 1;
    if (this.open.told || this.open.steps < rules.recoverWithin) return [];
    this.open.told = true;
    return [fact("no-recovery", `${rules.recoverWithin} steps since \`${oneLine(this.open.command, 100)}\` failed, and neither it nor the gate has passed since`)];
  }

  reset(): void {
    this.open = undefined;
  }
}

/** The instruction's calls, with where the last edit inside the working copy and the last run of the gate fell. */
function lastWriteAndGate(window: Window, rules: Rules) {
  const calls = window.sinceInstruction().flatMap((unit) => (unit.kind === "call" ? [unit.call] : []));
  // Prose needs no gate: a hand-back that only wrote docs was told it had not run the tests.
  const inside = (call: Call) => (call.detail.type === "edit" || call.detail.type === "write") && !escapes(str(call.detail.filePath), rules) && !PROSE.test(str(call.detail.filePath));
  let lastWrite = -1;
  let lastGate = -1;
  calls.forEach((call, index) => {
    if (inside(call) && !failed(call)) lastWrite = index;
    if (isGate(call, rules.gates)) lastGate = index;
  });
  return { calls, inside, lastWrite, lastGate };
}

export function unverified(window: Window, rules: Rules, heard: boolean): Fact[] {
  const named = rules.gates[0];
  if (!heard || !named) return [];
  const { calls, inside, lastWrite, lastGate } = lastWriteAndGate(window, rules);
  if (lastWrite < 0 || lastGate > lastWrite) return [];
  const written = new Set(calls.filter(inside).map((call) => str(call.detail.filePath)));
  return [fact("unverified", `${written.size} file${written.size === 1 ? "" : "s"} written and \`${oneLine(named, 100)}\` not run after the last of them`)];
}

/** A hand-back that says the work is complete when the check it ran after its last edit failed: the record, not the claim, is what settles it. */
export function contradicted(window: Window, rules: Rules, outcome: string | undefined): Fact[] {
  if (outcome !== "complete") return [];
  const { calls, lastWrite, lastGate } = lastWriteAndGate(window, rules);
  const check = calls[lastGate];
  if (!check || lastGate < lastWrite || !failed(check)) return [];
  return [fact("claim-contradicted", `handed back as complete, but \`${oneLine(str(check.detail.command), 100)}\` failed the last time it ran, after the last edit`)];
}

/** A turn whose first change came before it read, searched or ran anything since an instruction the window still holds: what it was told, taken on trust. */
export function editBeforeLook(window: Window, rules: Rules): Fact[] {
  if (!window.instruction()) return [];
  const first = window.sinceInstruction().find((unit) => unit.kind === "call" && !unit.call.pseudo && !rules.desk?.(unit.call));
  if (first?.kind !== "call" || (first.call.detail.type !== "edit" && first.call.detail.type !== "write")) return [];
  return [fact("edit-before-look", `changed ${oneLine(str(first.call.detail.filePath))} before reading or running anything`)];
}
