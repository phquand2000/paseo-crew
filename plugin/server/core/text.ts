import { createHash } from "node:crypto";
import { mask } from "./mask.ts";

/** Text from outside the team, fenced so it cannot speak as the desk: the words inside must not be able to close the fence. */
export function outside(tag: string, text: string, limit: number): string {
  // One pass, cutting a fence as its last character arrives: a removal can join a new fence, and repeated sweeps go quadratic.
  const open = `<${tag}>`.toLowerCase();
  const close = `</${tag}>`.toLowerCase();
  const kept: string[] = [];
  const ends = (token: string) => {
    if (kept.length < token.length) return false;
    for (let at = 0; at < token.length; at++) if (kept[kept.length - token.length + at]!.toLowerCase() !== token[at]) return false;
    return true;
  };
  for (let at = 0; at < text.length; at++) {
    kept.push(text[at]!);
    const fence = ends(close) ? close : ends(open) ? open : undefined;
    if (fence) kept.length -= fence.length;
  }
  return clip(kept.join(""), limit);
}

export const hash = (...parts: string[]): string => createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 12);

export function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}\n[… ${text.length - limit} more characters]`;
}

/** The first `limit` of a list, and how many more there are. */
export const capped = (items: string[], limit: number): string => (items.length > limit ? `${items.slice(0, limit).join(", ")} and ${items.length - limit} more` : items.join(", "));

/** At most `limit` characters, never cutting a character in two. */
export function within(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Text quoted from a seat's own record on one line, its secrets masked. */
export const oneLine = (text: string, limit = 200): string => within(mask(text).replace(/\s+/g, " ").trim(), limit);

/** Cut between words when a title runs past `max`, so a branch never ends in half a word. */
export function slugify(text: string, max = 32): string {
  const whole = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (whole.length <= max) return whole || "work";
  const cut = whole.slice(0, max + 1);
  return cut.includes("-") ? cut.slice(0, cut.lastIndexOf("-")) : cut.slice(0, max);
}
