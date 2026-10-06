import { clip } from "../../core/text.ts";
import type { Ask } from "../../domain/ask.ts";

export const list = (items: string[] | undefined, empty = "none") =>
  items && items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : empty;
export const firstLine = (text: string) =>
  text
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim() ?? "";

/** A person's note as a sentence: theirs often ends in a full stop already, and one more reads as a typo. */
export const ended = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** Every kind of letter the desk mails. A letter's key starts with its kind, and so does the id Paseo shows for the message. */
type Kind =
  | "answer"
  | "answeredFor"
  | "ask"
  | "amended"
  | "baseconflict"
  | "beside"
  | "brief"
  | "canland"
  | "carried"
  | "case"
  | "closed"
  | "detour"
  | "disk"
  | "done"
  | "failed"
  | "gone"
  | "halfopen"
  | "held"
  | "hold"
  | "humananswered"
  | "humanwrote"
  | "idle"
  | "incident"
  | "land"
  | "landed"
  | "landback"
  | "landheld"
  | "lanebeside"
  | "lease"
  | "leaseended"
  | "later"
  | "leadgone"
  | "limited"
  | "limitreset"
  | "merge"
  | "message"
  | "moment"
  | "notstarted"
  | "nudge"
  | "opened"
  | "overruled"
  | "pending"
  | "permission"
  | "permissionanswered"
  | "reconcile"
  | "released"
  | "report"
  | "resumed"
  | "retry"
  | "rework"
  | "settling"
  | "silent"
  | "started"
  | "taken"
  | "unanswered";

/** A letter the desk mails a seat: its text, the key under which a second one to that seat is the same letter, and `wakes` false for word that asks nothing of its reader now, which rides along with the next letter that does. */
export type Letter = { key: string; text: string; wakes?: false };

export const keyOf = (kind: Kind, ids: (string | number)[]) => [kind, ...ids].join(":");

const CHANGES_THE_WORK: ReadonlySet<string> = new Set<Kind>([
  "amended",
  "answer",
  "brief",
  "landed",
  "message",
  "rework",
]);

/** Whether a letter changes the work its reader is on, so its hand-back or ask waits until it has read it. */
export const heeded = (letter: { key: string; wakes?: false }) =>
  letter.wakes !== false && CHANGES_THE_WORK.has(letter.key.split(":")[0]!);

/** Keyed by its kind and the ids that make it this letter, never by hand where it is posted; it ends with `next`, what it asks of whoever reads it. */
export const mail = (kind: Kind, ids: (string | number)[], text: string, next: string): Letter => ({
  key: keyOf(kind, ids),
  text: `${text}\n\nNext: ${next}`,
});

export const fyi = (letter: Letter): Letter => ({ ...letter, wakes: false });

/** Several letters delivered at once, and the asks still waiting on their reader. */
export function mailbox(items: string[], open: Ask[]): string {
  const head = items.length === 1 ? "" : `${items.length} messages\n\n`;
  const body = items.join("\n\n---\n\n");
  if (open.length === 0) return `${head}${body}`;
  const asks = open.map((ask) => `- ${ask.id} (${ask.kind}): ${clip(firstLine(ask.text), 160)}`).join("\n");
  return `${head}${body}\n\n---\n\nOpen asks waiting on you:\n${asks}`;
}
