import type { Lane } from "./ledger.ts";
import { type Letter, ended, fyi, mail } from "./letters.ts";

/** The letters a landing sends: that it may go ahead, that it waits on the Human, and what the Human decided. */
export const landLetters = {
  canLand(lane: Lane): Letter {
    return mail("canland", [lane.id, Date.now()], `CAN LAND ${lane.id} (${lane.title}): the turn that was in the way has ended.`, "land_lane it again.");
  },

  /** The way back out of a DETOUR: the lane that waited is told, since it cannot see the other one; dropped, the way is not cleared. */
  detourClosed(detour: Lane, waiting: Lane, landing: string, landed: boolean): Letter {
    if (!landed) {
      const text = `DETOUR DROPPED ${detour.id} (${detour.title}), the detour your lane ${waiting.id} was waiting on: it closed without landing, and its branch ${detour.branch} is kept.`;
      return mail("detour", [detour.id, Date.now()], text, "Go on without it; ask if your lane still needs what it was for.");
    }
    const text = [`CLEARED ${detour.id} (${detour.title}), the detour your lane ${waiting.id} was waiting on: ${landing}.`, "", `Your lane branch ${waiting.branch} does not have it yet.`].join("\n");
    return mail("detour", [detour.id, Date.now()], text, "Read what it did before you go on; ask if your work needs it on your branch.");
  },

  /** `head` is the lane's tip it was held at: a hold is told once per commit, and asks nothing of a Lead that has stopped. */
  landHeld(lane: Lane, reason: string, head: string): Letter {
    const text = `LAND HELD ${lane.id} (${lane.title}): the Human looks at it before it lands. ${reason} Approved, it lands and the lane closes; sent back, LAND SENT BACK brings their note. A new commit means it is looked at again from the start.`;
    return fyi(mail("landheld", [lane.id, head], text, "Commit nothing more on the lane until the Human decides."));
  },

  /** No seat may run git merge, so landing began bringing the base in and left what stopped it for a Peer to settle. */
  baseConflict(lane: Lane, conflicts: string[]): Letter {
    const text = `BASE CONFLICT ${lane.id} (${lane.title}): ${lane.base} moved on, and merging it into ${lane.branch} stopped on conflicts in ${conflicts.join(", ")}. The merge is left in your working copy, and landing waits for it.`;
    return mail("baseconflict", [lane.id, conflicts.join(",")], text, "add_tasks one task owning those files to settle them and commit the merge with git commit, then report the lane ready again.");
  },

  landSentBack(lane: Lane, note: string, head: string): Letter {
    return mail("landback", [lane.id, head], `LAND SENT BACK ${lane.id} (${lane.title}): ${ended(note || "the Human gave no reason; ask what to change")} The lane stays open.`, "Act on the note, then report the lane ready again.");
  },

  landDecided(lane: Lane, how: "landed" | "blocked" | "again" | "changed" | "sent back", text: string): Letter {
    const told = (said: string, next: string) => mail("land", [lane.id, how, Date.now()], said, next);
    if (how === "landed") return fyi(told(`LANDED ${lane.id} (${lane.title}) after the Human approved it: ${text}`, "Nothing now."));
    if (how === "sent back") return fyi(told(`SENT BACK ${lane.id} (${lane.title}) by the Human: ${ended(text || "no reason was given")} The lane stays open, and its Lead has the note.`, "Nothing now."));
    if (how === "again") return told(`HELD AGAIN ${lane.id} (${lane.title}): the Human approved it, but landing it turned up more. ${text}`, "Tell the Human it waits for them again, and why.");
    if (how === "changed") return told(`CHANGED ${lane.id} (${lane.title}) after its landing was held, so the Human's approval did not count.`, "land_lane it to have it checked as it is now.");
    return told(`APPROVED ${lane.id} (${lane.title}) for landing by the Human, but it could not land yet: ${text}. The approval stands while the lane does not change.`, "Clear what it names; land_lane then lands it without asking the Human again.");
  },
};
