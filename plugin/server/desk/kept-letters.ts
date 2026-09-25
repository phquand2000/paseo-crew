import type { Lane } from "./ledger.ts";
import { type Letter, fyi, mail } from "./letters.ts";

/** What the desk mails a seat kept on after its work: a Lead whose lane closed. */
export const keptLetters = {
  /** Its lane closed under it, which asks nothing of it now: read with whatever wakes it next. */
  closed(lane: Lane, landed: boolean, how: string): Letter {
    const text = `LANE CLOSED ${lane.id} (${lane.title}): ${landed ? "landed" : "dropped"}; ${how}. Its Peers are let go, and you stay on with what you know of it until the owner releases you.`;
    return fyi(mail("closed", [lane.id], text, "Nothing of the lane is yours to do now: answer whoever writes to you about it."));
  },
};
