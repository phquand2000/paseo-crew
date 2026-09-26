import type { Counts } from "../core/git.ts";
import type { Task } from "./ledger.ts";
import { type Letter, fyi, mail } from "./letters.ts";

/** The letters the merge of an accepted task sends its Lead: merged, failed, or stopped on conflicts. */
export const mergeLetters = {
  /** `last` when no other task of the lane is left to accept or cut: only then does a merge with nothing to note ask anything of the Lead. */
  merged(task: Task, counts: Counts | undefined, outside: string[], gate: string, last: boolean): Letter {
    const lines = [
      counts?.files.length === 0 ? `MERGED ${task.id} (${task.title}): it changed no files, so there was nothing to merge.` : `MERGED ${task.id} (${task.title}) into the lane branch.`,
      counts ? `Lines changed: source ${counts.src}, tests ${counts.test}, docs ${counts.docs}.` : "Lines changed: git could not say, so this is the merge without its size.",
      `Gate: ${gate}`,
    ];
    const notes: string[] = [];
    if (counts && counts.src === 0 && counts.test + counts.docs > 0) notes.push("Note: no source lines changed.");
    if (counts && counts.src > 0 && counts.test > counts.src * 1.5) notes.push(`Note: test lines are ${(counts.test / counts.src).toFixed(1)} times source lines.`);
    if (outside.length > 0) notes.push(`Note: files outside the owned paths: ${outside.slice(0, 10).join(", ")}`);
    const letter = (next: string) => mail("merge", [task.id, Date.now()], [...lines, ...notes].join("\n"), next);
    if (last) return letter("Every task of the lane is settled: if its outcome is complete, have the whole lane reviewed (start_review, no task), then report it ready.");
    return notes.length > 0 ? letter("Act on a note only if it matters to the lane.") : fyi(letter("Nothing now: the next hand-back arrives as mail."));
  },

  /** The Lead's accept stands while the lane's copy is not clean: the task stays queued and merges once a turn ends with it clean. */
  waits(task: Task, why: string, holder: string | undefined): Letter {
    const text = `MERGE WAITS ${task.id} (${task.title}): ${why}. It merges by itself once ${holder ? "that work is committed" : "they are committed or cleared"}.`;
    return holder
      ? fyi(mail("merge", [task.id, Date.now()], text, "Nothing now: MERGED arrives as mail, and cut withdraws the task."))
      : mail("merge", [task.id, Date.now()], text, "Have a task of the lane commit or clear them, or cut the task to withdraw it.");
  },

  mergeFailed(task: Task, reason: string, tail: string): Letter {
    const lines = [`MERGE FAILED ${task.id} (${task.title}): ${reason}`, "The lane branch is unchanged."];
    if (tail) lines.push("", "```", tail, "```");
    return mail("merge", [task.id, Date.now()], lines.join("\n"), "Clear what it names, then accept it again.");
  },

  /** `settling` is how bringing the lane branch into the task's own copy went, since no seat may run git merge: left with its conflicts, clean, or not begun. */
  conflict(task: Task, conflicts: string[], laneBranch: string, settling: "left" | "clean" | { not: string }): Letter {
    const [done, next] =
      settling === "left"
        ? [`The desk began merging ${laneBranch} into the task's branch in its own copy and left the conflicts there.`, "Send rework asking its Peer to settle them and commit the merge with git commit, then accept it again; or cut the task."]
        : settling === "clean"
          ? [`The desk merged ${laneBranch} into the task's branch in its own copy without conflicts.`, "Accept it again."]
          : [`The desk could not begin merging ${laneBranch} into the task's branch in its own copy, because ${settling.not}.`, "Send rework asking its Peer to commit what is left there, then accept it again; or cut the task."];
    const text = [`MERGE CONFLICT ${task.id} (${task.title}) with ${laneBranch}.`, `Files: ${conflicts.join(", ") || "unknown"}`, `The lane branch is unchanged. ${done}`].join("\n");
    return mail("merge", [task.id, Date.now()], text, next);
  },
};
