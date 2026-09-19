import { isAbsolute, relative } from "node:path";
import { globToRegex, normalize } from "../../core/scope.ts";
import type { Call, Change, Unit, Window } from "./window.ts";

export const DESTRUCTIVE =
  "rm\\s+-[a-z]*[rf]|git\\s+reset\\s+--hard|git\\s+clean\\s+-[a-z]*f|git\\s+push\\s+[^|;&]*(--force|-f)\\b|--force-with-lease|git\\s+branch\\s+-D|drop\\s+(table|database)|truncate\\s+table";

export const TEST_PATH = "(^|/)(tests?|specs?|__tests__)/|[._-](test|spec)\\.[a-z]+$|(^|/)test_[^/]*\\.[a-z]+$";

export const SUPPRESSED = "@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|#\\s*type:\\s*ignore|#\\s*noqa|\\bas\\s+any\\b";

const ASSERTION = "\\b(assert|expect|should)\\b";
const SKIPPED = "\\.(skip|only|todo)\\b|\\bx(it|describe|test)\\b|@Disabled\\b|pytest\\.mark\\.skip\\b";

export type Level = "page" | "attend" | "note";

export type Fact = { kind: string; level: Level; quote: string };

export type Rules = {
  destructive: RegExp;
  testPath: RegExp;
  suppressed: RegExp;
  exit?: RegExp;
  gate?: string;
  cwd?: string;
  owned?: string[];
  repeatsAt: number;
  recoverWithin: number;
};

const count = (text: string, pattern: string): number => (text.match(new RegExp(pattern, "gi")) ?? []).length;
const flat = (text: string, limit = 200): string => text.replace(/\s+/g, " ").trim().slice(0, limit);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

export function failed(call: Call, exit?: RegExp): boolean {
  if (call.status === "failed") return true;
  if (typeof call.detail.exitCode === "number") return call.detail.exitCode !== 0;
  const code = exit?.exec(str(call.detail.output).trim())?.[1];
  return code !== undefined && Number(code) !== 0;
}

export function isGate(call: Call, gate?: string): boolean {
  return Boolean(gate) && call.detail.type === "shell" && str(call.detail.command).includes(gate!);
}

function actionOf(call: Call): string {
  const { output: _output, exitCode: _exit, ...rest } = call.detail;
  return `${call.name}\n${JSON.stringify(rest)}`;
}

function resultOf(call: Call, exit?: RegExp): string {
  return `${failed(call, exit) ? "failed" : "ok"}\n${str(call.detail.output)}\n${JSON.stringify(call.error ?? null)}`;
}

export function stuck(units: Unit[], rules: Pick<Rules, "exit" | "repeatsAt">): string | undefined {
  const recent = units.slice(-20);
  const calls = recent.flatMap((unit) => (unit.kind === "call" && unit.call.ended ? [unit.call] : []));
  const same = (list: string[]) => list.every((value) => value === list[0]);
  const n = rules.repeatsAt;
  const tail = calls.slice(-(n + 1));
  if (tail.length === n + 1 && same(tail.map(actionOf)) && same(tail.map((call) => resultOf(call, rules.exit)))) {
    return `the same action with the same result ${n + 1} times: ${flat(describe(tail[0]!), 120)}`;
  }
  const errors = calls.slice(-n);
  if (errors.length === n && same(errors.map(actionOf)) && errors.every((call) => failed(call, rules.exit))) {
    return `the same action failing ${n} times: ${flat(describe(errors[0]!), 120)}`;
  }
  const spoken = recent.filter((unit) => unit.kind !== "thought");
  for (const said of [spoken.slice(-n), spoken.slice(-n - 1, -1)]) {
    if (said.length === n && said.every((unit) => unit.kind === "said") && same(said.map((unit) => (unit.kind === "said" ? flat(unit.text, 2000) : "")))) {
      return `the same words ${n} times with nothing done between them`;
    }
  }
  const cycle = calls.slice(-2 * n);
  if (cycle.length === 2 * n) {
    const actions = cycle.map(actionOf);
    const alternates = actions[0] !== actions[1] && actions.every((action, index) => action === actions[index % 2]);
    if (alternates) return `alternating between two actions ${n} times: ${flat(describe(cycle[0]!), 60)} / ${flat(describe(cycle[1]!), 60)}`;
  }
  return undefined;
}

export function describe(call: Call): string {
  const detail = call.detail;
  const what = str(detail.command) || str(detail.filePath) || str(detail.url) || str(detail.query);
  return [call.name || "tool", what].filter(Boolean).join(": ");
}

function outside(path: string, rules: Rules): boolean {
  if (!path || /\s/.test(path) || !rules.cwd) return false;
  const rel = isAbsolute(path) ? relative(rules.cwd, path) : normalize(path);
  if (rel.startsWith("..")) return true;
  if (!rules.owned || rules.owned.length === 0) return false;
  return !rules.owned.some((glob) => globToRegex(glob).test(rel));
}

export function onDetail(call: Call, rules: Rules): Fact[] {
  if (call.detail.type !== "shell") return [];
  const command = str(call.detail.command);
  return command && rules.destructive.test(command) ? [{ kind: "destructive", level: "page", quote: flat(command) }] : [];
}

export function onSettle(call: Call, rules: Rules): Fact[] {
  const facts: Fact[] = [];
  const detail = call.detail;
  if (failed(call, rules.exit)) facts.push({ kind: isGate(call, rules.gate) ? "gate-failed" : "call-failed", level: "note", quote: flat(describe(call)) });
  if (detail.type === "edit" && !failed(call, rules.exit)) {
    const path = str(detail.filePath);
    const before = str(detail.oldString);
    const after = str(detail.newString);
    if (rules.testPath.test(path) && (before || after)) {
      const lost = count(before, ASSERTION) - count(after, ASSERTION);
      const muted = new RegExp(SKIPPED, "i").test(after) && !new RegExp(SKIPPED, "i").test(before);
      if (lost > 0 || muted) {
        facts.push({ kind: "test-weakened", level: "attend", quote: muted ? `${path}: adds a skip marker` : `${path}: ${count(before, ASSERTION)} assertions become ${count(after, ASSERTION)}` });
      }
    }
    const added = after.match(rules.suppressed)?.[0];
    if (added && !rules.suppressed.test(before)) facts.push({ kind: "suppressed", level: "attend", quote: `${path}: adds ${added}` });
  }
  if ((detail.type === "edit" || detail.type === "write") && outside(str(detail.filePath), rules)) {
    facts.push({ kind: "outside-scope", level: "note", quote: flat(str(detail.filePath)) });
  }
  return facts;
}

export class Recovery {
  private open: { command: string; steps: number; told: boolean } | undefined;

  step(call: Call, rules: Rules): Fact[] {
    const shell = call.detail.type === "shell";
    const command = str(call.detail.command);
    const bad = failed(call, rules.exit);
    if (!this.open) {
      if (shell && bad) this.open = { command, steps: 0, told: false };
      return [];
    }
    if (shell && !bad && (command === this.open.command || isGate(call, rules.gate))) {
      this.open = undefined;
      return [];
    }
    this.open.steps += 1;
    if (this.open.told || this.open.steps < rules.recoverWithin) return [];
    this.open.told = true;
    return [{ kind: "no-recovery", level: "attend", quote: `${rules.recoverWithin} steps since \`${flat(this.open.command, 100)}\` failed, and neither it nor the gate has passed since` }];
  }

  reset(): void {
    this.open = undefined;
  }
}

export function unverified(window: Window, rules: Rules, heard: boolean): Fact[] {
  if (!heard || !rules.gate) return [];
  const calls = window.sinceInstruction().flatMap((unit) => (unit.kind === "call" ? [unit.call] : []));
  let lastWrite = -1;
  let lastGate = -1;
  calls.forEach((call, index) => {
    if ((call.detail.type === "edit" || call.detail.type === "write") && !failed(call, rules.exit)) lastWrite = index;
    if (isGate(call, rules.gate)) lastGate = index;
  });
  if (lastWrite < 0 || lastGate > lastWrite) return [];
  const written = new Set(calls.filter((call) => call.detail.type === "edit" || call.detail.type === "write").map((call) => str(call.detail.filePath)));
  return [{ kind: "unverified", level: "attend", quote: `${written.size} file${written.size === 1 ? "" : "s"} written and \`${rules.gate}\` not run after the last of them` }];
}

export function afterChange(change: Change, rules: Rules): Fact[] {
  const call = change.call;
  if (!call) return [];
  return [...(change.detailed ? onDetail(call, rules) : []), ...(change.settled ? onSettle(call, rules) : [])];
}
