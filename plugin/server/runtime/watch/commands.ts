import { isAbsolute, normalize, relative } from "node:path";
import { oneLine, within } from "../../core/text.ts";
import { type Fact, fact } from "./fact-kinds.ts";
import { type Rules, temporary } from "./facts.ts";
import { shellWords } from "./shell-words.ts";
import type { Call } from "./window.ts";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const SCRATCH = /^\$\{?TMPDIR(?:[%#:][^}]*)?\}?(?:\/|$)/;
const MKTEMP = /^(?:\$\(\s*mktemp\b[^)]*\)|`\s*mktemp\b[^`]*`)$/;
const VARIABLE = /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g;
const ASSIGN = /^([A-Za-z_]\w*)=(.*)$/s;
const HEREDOC = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/g;
/** Programs that only store what they read: a heredoc fed to one is data, and any other program may run it. */
const STORES = new Set(["cat", "tee"]);
const QUOTED = /(?<!<<-?\s*)(["'])(?:(?!\1).)*\1/g;
/** Words before a command that only say when it runs: a loop, a branch, a group or a function's head. */
const PREFIX = /^(?:do|then|else|elif|if|while|until|!|time|\{|\(+|[A-Za-z_][\w-]*\(\)\{?)$/;
const DECLARE = new Set(["export", "local", "declare", "readonly", "typeset"]);

const leading = (list: string[]): string[] => {
  while (list.length > 0 && PREFIX.test(list[0]!)) list.shift();
  return list;
};

/** The command without the heredoc bodies only `cat` or `tee` read: a script written to a file is not run by this call. */
function runLines(command: string): string {
  const kept: string[] = [];
  const bodies: { end: string; dash: boolean; runs: boolean }[] = [];
  for (const line of command.split("\n")) {
    const body = bodies.at(-1);
    if (body && (body.dash ? line.replace(/^\t+/, "") : line) === body.end) {
      bodies.pop();
      continue;
    }
    if (body && !body.runs) continue;
    kept.push(line);
    const markers = line
      .replace(QUOTED, "")
      .split(/&&|\|\||;/)
      .flatMap((command) => {
        const runs = !command.split("|").every((stage) => STORES.has(leading(shellWords(stage))[0] ?? ""));
        return [...command.matchAll(HEREDOC)].map((m) => ({ end: m[3]!, dash: m[1] === "-", runs }));
      });
    bodies.push(...markers.reverse());
  }
  return kept.join("\n");
}

/** What the command so far set: a name set twice may hold either value, as a branch decides, so it is known to be neither. */
type Known = { values: Map<string, string>; temps: Set<string>; twice: Set<string>; made: string[] };

const expand = (word: string, known: Known): string =>
  word.replace(VARIABLE, (whole, braced?: string, bare?: string) => {
    const name = braced ?? bare ?? "";
    if (known.twice.has(name)) return whole;
    return known.temps.has(name) ? `\0${name}` : (known.values.get(name) ?? whole);
  });

/** The command word once the words that only say when it runs are gone; assignments before it are learned. */
function commandOf(part: string, known: Known): string[] {
  const list = leading(shellWords(part));
  if (DECLARE.has(list[0] ?? "")) list.shift();
  while (list.length > 0 && ASSIGN.test(list[0]!)) {
    const [, name = "", value = ""] = ASSIGN.exec(list.shift()!)!;
    if (known.temps.has(name) || known.values.has(name)) known.twice.add(name);
    if (MKTEMP.test(value.trim())) known.temps.add(name);
    else known.values.set(name, expand(value, known));
  }
  return list;
}

const operands = (list: string[], known: Known): string[] =>
  list
    .slice(1)
    .filter((word) => !word.startsWith("-"))
    .map((word) => normalize(expand(word, known)));

const below = (root: string, target: string, strict: boolean): boolean => {
  if (!isAbsolute(target)) return false;
  const rel = relative(root, target);
  return !rel.startsWith("..") && !isAbsolute(rel) && (!strict || rel !== "");
};

/** An `rm` whose every target is scratch: $TMPDIR, /tmp, the machine's temporary directory, what the command made, or below what the seat was granted outside its copy. */
function scratchOnly(list: string[], known: Known, rules: Rules): boolean {
  const targets = operands(list, known);
  const scratch = (target: string) =>
    target.startsWith("\0") ||
    SCRATCH.test(target) ||
    temporary(target, rules) ||
    (rules.outside ?? []).some((root) => below(root, target, true)) ||
    known.made.some((path) => target === path || target.startsWith(`${path.replace(/\/$/, "")}/`));
  return targets.length > 0 && targets.every(scratch);
}

export function onDetail(call: Call, rules: Rules): Fact[] {
  if (call.detail.type !== "shell") return [];
  // A command at a time: removing a commit message's temp file once paged a Lead.
  const parts = runLines(str(call.detail.command)).split(/&&|\|\||;|\n/);
  const known: Known = { values: new Map(), temps: new Set(), twice: new Set(), made: [] };
  const found = new Map<"irreversible" | "destructive", string>();
  for (const part of parts) {
    const list = commandOf(part, known);
    if (list[0] === "mkdir" || list[0] === "touch") known.made.push(...operands(list, known));
    if (!found.has("irreversible") && rules.irreversible.test(part)) found.set("irreversible", part);
    if (
      !found.has("destructive") &&
      rules.destructive.test(part) &&
      !(list[0] === "rm" && scratchOnly(list, known, rules))
    )
      found.set("destructive", part);
  }
  return [...found].map(([kind, part]) => fact(kind, around(oneLine(part, Infinity), rules[kind], 200)));
}

/** Cuts around the match, not from the front: what makes a long command irreversible is often at its end. */
function around(text: string, pattern: RegExp | undefined, limit: number): string {
  if (text.length <= limit) return text;
  const found = pattern ? new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(text) : null;
  const start =
    found && found.index + found[0].length > limit
      ? Math.max(0, Math.min(found.index - Math.floor(limit / 4), text.length - limit))
      : 0;
  const body = within(text.slice(start).replace(/^[\uDC00-\uDFFF]/, ""), limit);
  return `${start > 0 ? "…" : ""}${body}${start + body.length < text.length ? "…" : ""}`;
}
