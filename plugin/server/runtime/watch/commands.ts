import { oneLine, within } from "../../core/text.ts";
import { type Fact, fact } from "./fact-kinds.ts";
import type { Rules } from "./facts.ts";
import { shellWords } from "./shell-words.ts";
import type { Call } from "./window.ts";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const HEREDOC = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/g;
/** Programs that only store what they read: a heredoc fed to one is data, and any other program may run it. */
const STORES = new Set(["cat", "tee"]);
const QUOTED = /(?<!<<-?\s*)(["'])(?:(?!\1).)*\1/g;
/** Words before a command that only say when it runs: a loop, a branch, a group or a function's head. */
const PREFIX = /^(?:do|then|else|elif|if|while|until|!|time|\{|\(+|[A-Za-z_][\w-]*\(\)\{?)$/;

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

export function onDetail(call: Call, rules: Rules): Fact[] {
  if (call.detail.type !== "shell") return [];
  const part = runLines(str(call.detail.command))
    .split(/&&|\|\||;|\n/)
    .find((part) => rules.irreversible.test(part));
  return part === undefined ? [] : [fact("irreversible", around(oneLine(part, Infinity), rules.irreversible, 200))];
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
