import { isAbsolute, relative } from "node:path";
import { oneLine, within } from "../../core/text.ts";
import { type Fact, type Rules, fact } from "./facts.ts";
import type { Call } from "./window.ts";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const SCRATCH = /^(?:\$\{?TMPDIR\}?|\/tmp|\/private\/tmp)(?:\/|$)/;
const MKTEMP = /\b([A-Za-z_]\w*)=["']?(?:\$\(\s*mktemp\b[^)]*\)|`\s*mktemp\b[^`]*`)/g;
const VARIABLE = /^\$\{?([A-Za-z_]\w*)\}?(?:\/|$)/;

const unquoted = (word: string) => word.replace(/^["']|["']$/g, "");

/** What a command makes for itself before it removes it: the variables it sets from mktemp, and what it creates with mkdir or touch. */
function madeBy(parts: string[]): { variables: Set<string>; paths: string[] } {
  const variables = new Set([...parts.join("\n").matchAll(MKTEMP)].map((match) => match[1]!));
  const paths = parts.flatMap((part) => {
    const words = part.trim().split(/\s+/);
    return words[0] === "mkdir" || words[0] === "touch"
      ? words
          .slice(1)
          .filter((word) => !word.startsWith("-"))
          .map(unquoted)
      : [];
  });
  return { variables, paths };
}

/** An `rm` whose every target is scratch space: $TMPDIR, /tmp, the machine's temporary directory, or what the same command made. */
function scratchOnly(part: string, made: ReturnType<typeof madeBy>, temp?: string): boolean {
  const words = part.trim().split(/\s+/);
  if (words[0] !== "rm") return false;
  const targets = words
    .slice(1)
    .filter((word) => !word.startsWith("-"))
    .map(unquoted);
  const scratch = (target: string) =>
    SCRATCH.test(target) ||
    Boolean(temp && isAbsolute(target) && !relative(temp, target).startsWith("..")) ||
    made.variables.has(VARIABLE.exec(target)?.[1] ?? "") ||
    made.paths.some((path) => target === path || target.startsWith(`${path.replace(/\/$/, "")}/`));
  return targets.length > 0 && targets.every(scratch);
}

export function onDetail(call: Call, rules: Rules): Fact[] {
  if (call.detail.type !== "shell") return [];
  // A command at a time: removing a commit message's temp file once paged a Lead.
  const parts = str(call.detail.command).split(/&&|\|\||;|\n/);
  const made = madeBy(parts);
  const risky = parts.find((part) => rules.destructive.test(part) && !scratchOnly(part, made, rules.temp));
  return risky ? [fact("destructive", around(oneLine(risky, Infinity), rules.destructive, 200))] : [];
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
