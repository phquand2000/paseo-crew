import type { Counts } from "../../core/git-diff.ts";
import type { Task } from "../../domain/task.ts";
import { type Letter, fyi, mail } from "./envelope.ts";

/** The letters the merge of an accepted task sends its Lead: merged, failed, or stopped on conflicts. */
export const mergeLetters = {
  /** `reach` is what of its files the Lead should weigh; `last` when no other task of the lane is left to accept or cut: only then does a merge with nothing to note ask anything of the Lead. */
  merged(task: Task, counts: Counts | undefined, reach: string[], gate: string, last: boolean): Letter {
    const lines = [
      counts?.files.length === 0
        ? `MERGED ${task.id} (${task.title}): it changed no files, so there was nothing to merge.`
        : `MERGED ${task.id} (${task.title}) into the lane branch.`,
      counts
        ? `Lines changed: source ${counts.src}, tests ${counts.test}, docs ${counts.docs}.`
        : "Lines changed: git could not say, so this is the merge without its size.",
      `Gate: ${gate}`,
    ];
    const notes: string[] = [];
    if (counts && counts.src === 0 && counts.test + counts.docs > 0) notes.push("Note: no source lines changed.");
    for (const note of reach) notes.push(`Note: ${note}.`);
    const letter = (next: string) => mail("merge", [task.id, Date.now()], [...lines, ...notes].join("\n"), next);
    if (last) return letter("Every task of the lane is settled: if its outcome is complete, report it ready.");
    return notes.length > 0
      ? letter("Act on a note only if it matters to the lane.")
      : fyi(letter("Nothing now: the next hand-back arrives as mail."));
  },

  /** The Lead's accept stands while something keeps the merge from its lane: the task stays queued and merges once that clears. `clears`, when that asks for the Lead. */
  waits(task: Task, why: string, clears: boolean): Letter {
    const text = `MERGE WAITS ${task.id} (${task.title}): ${why}. It merges by itself once that clears, tried again each time an agent stops.`;
    return clears
      ? mail(
          "merge",
          [task.id, Date.now()],
          text,
          "Have what is left there committed or cleared, or cut the task to withdraw it.",
        )
      : fyi(
          mail(
            "merge",
            [task.id, Date.now()],
            text,
            "Nothing now: MERGED arrives as mail, and cut withdraws the task.",
          ),
        );
  },

  /** Its gate failed on its branch with the lane brought in: `run` is the failing run when this merge ran it, and none when its hand-back did. */
  red(task: Task, lane: string, note: string, run?: { tail: string; logFile: string }): Letter {
    const lines = [
      `MERGE RED ${task.id} (${task.title}): the gate failed on its branch with ${lane} brought in, the tree the lane would become. The lane branch is unchanged.`,
      `Gate: ${note}`,
    ];
    lines.push(...(run ? ["", run.tail, "", `Full log: ${run.logFile}`] : ["Its hand-back carries the log."]));
    return mail(
      "merge",
      [task.id, Date.now()],
      lines.join("\n"),
      "Send rework to its engineer with what must change, or accept it again with overGate and a reason to merge it over the gate.",
    );
  },

  mergeFailed(task: Task, reason: string, tail: string): Letter {
    const lines = [`MERGE FAILED ${task.id} (${task.title}): ${reason}`, "The lane branch is unchanged."];
    if (tail) lines.push("", "```", tail, "```");
    return mail("merge", [task.id, Date.now()], lines.join("\n"), "Clear what it names, then accept it again.");
  },

  /** `settling` is how the desk's bringing the lane branch into the task's own copy went: left with its conflicts, clean, or not begun; `by`, the tasks whose merges wrote the lane's side. */
  conflict(
    task: Task,
    conflicts: string[],
    laneBranch: string,
    settling: "left" | "clean" | { not: string },
    by: string[] = [],
  ): Letter {
    const [done, next] =
      settling === "left"
        ? [
            `Merging ${laneBranch} into the task's branch in its own copy stopped on conflicts, which are left there.`,
            "Send rework asking its engineer to settle them and commit the merge with git commit --no-edit, since an editor would wait forever in its session, then accept it again; or cut the task.",
          ]
        : settling === "clean"
          ? [`${laneBranch} merged into the task's branch in its own copy without conflicts.`, "Accept it again."]
          : [
              `Merging ${laneBranch} into the task's branch in its own copy could not begin, because ${settling.not}.`,
              "Send rework asking its engineer to commit what is left there, then accept it again; or cut the task.",
            ];
    const text = [
      `MERGE CONFLICT ${task.id} (${task.title}) with ${laneBranch}.`,
      `Files: ${conflicts.join(", ") || "unknown"}${by.length > 0 ? `, changed there by ${by.join(", ")}` : ""}`,
      `The lane branch is unchanged. ${done}`,
    ].join("\n");
    return mail("merge", [task.id, Date.now()], text, next);
  },
};
