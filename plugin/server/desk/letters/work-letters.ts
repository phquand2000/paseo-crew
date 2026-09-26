import { clip, hash } from "../../core/text.ts";
import type { Amendment } from "../../domain/amendment.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Task } from "../../domain/task.ts";
import { type Letter, fyi, list, mail } from "./envelope.ts";

const waited = (entry: Lane | Task, what: string): string => {
  const after = entry.after?.length ? ` to wait for ${entry.after.join(", ")}` : "";
  return `WAITING ${entry.id} (${entry.title}), the ${"lane" in entry ? (after ? "task you started" : "task from your plan") : "lane you opened"}${after}: ${what}`;
};

/** A task's and a lane's course: hand-backs and rework, reports and amendments, waits, starts and holds. */
export const workLetters = {
  /** `reader` is the Lead, or whoever supervises once the Lead is no longer seated. */
  handback(task: Task, file: string, body: string, peer: string, reader: "lead" | "supervisor"): Letter {
    const next =
      reader === "supervisor"
        ? "Its Lead is gone: replace_lead puts a new Lead on the lane, this hand-back included; drop_lane only if the lane is no longer wanted."
        : task.kind === "review"
          ? "Weigh its findings, then cut it: a review has nothing to merge. A changes verdict is settled before you report the lane ready."
          : "Judge it by what the work did, then accept, rework with exactly what must change, or cut; start_review first on a big or doubtful change.";
    return mail(
      "done",
      [task.id, hash(body)],
      [`HANDBACK ${task.id} (${task.title}) from ${peer}`, "", clip(body, 2500), "", `Full hand-back: ${file}`].join(
        "\n",
      ),
      next,
    );
  },

  /** Keyed by the task's count, not the words: a repeated instruction is a second instruction, not a duplicate. */
  rework(task: Task, text: string): Letter {
    return mail(
      "rework",
      [task.id, task.reworks ?? 0],
      ["REWORK requested by your lead", "", text].join("\n"),
      "Change what it names, commit on your branch, then call done again.",
    );
  },

  /** `found` is what the desk read itself rather than took from the Lead: the gate, a park, what landing it waits for, what it brings, and whether review changes stand. */
  report(
    lane: Lane,
    summary: string,
    ready: boolean,
    carried: string[] | undefined,
    found: {
      gate?: { ok: boolean; text: string };
      parked?: string;
      asks: string[];
      facts: string[];
      changes?: boolean;
    },
  ): Letter {
    const lines = [`REPORT ${lane.id} (${lane.title}): ${ready ? "ready to land" : "not ready"}`];
    if (found.parked) lines.push("", found.parked);
    if (found.gate) lines.push("", `Gate: ${found.gate.text}`);
    if (found.asks.length > 0) lines.push("", `Landing it waits for the Human. ${found.asks.join(" ")}`);
    if (found.facts.length > 0) lines.push("", "What the desk read of it:", list(found.facts));
    lines.push("", clip(summary, 2000), "", "Carried:", list(carried));
    const next = !ready
      ? "Reply only if it needs a decision of yours or changes one."
      : found.parked
        ? "Tell the Human it waits for their answer; once they give it, carry it into the lane and resume_lane it."
        : found.gate && !found.gate.ok
          ? "Landing over a red gate is your call: land_lane with overGate and a reason, or message the Lead."
          : found.changes
            ? "Its reviews asked for changes that nothing on record answers: ask the Lead whether they were met before you land_lane it."
            : found.asks.length > 0
              ? "land_lane it if acceptance is met: it then waits for the Human on the Flow tab, so tell them it waits, and why."
              : "land_lane it if acceptance is met and nothing carried loses or corrupts data; then tell the Human in two lines.";
    const text = lines.join("\n");
    return mail("report", [lane.id, hash(`${text}\n${next}`)], text, next);
  },

  amended(entry: Lane | Task, amendment: Amendment, reader: "lead" | "worker"): Letter {
    const now = entry as unknown as Record<string, string | string[]>;
    const show = (value: string | string[]) => (Array.isArray(value) ? list(value) : value || "none");
    const text = [
      `AMENDED ${entry.id} (${entry.title}): ${amendment.why}`,
      ...Object.entries(amendment.was).flatMap(([field, was]) => [
        "",
        `${field}, was:`,
        show(was),
        `${field}, now:`,
        show(now[field]!),
      ]),
      ...(reader === "lead" ? ["", "A READY you reported before this no longer stands."] : []),
    ].join("\n");
    const next =
      reader === "lead"
        ? "Carry it into the tasks it touches (amend_task a moved goal; cut and restart a task whose contract changed), then report ready once the lane meets it."
        : "Work to it as it stands now; if what you have done no longer fits it, say so in your hand-back.";
    return mail("amended", [entry.id, entry.amended?.length ?? 0], text, next);
  },

  /** Why a lane or task still waits, told once per reason, and what its reader can do about it. */
  held(entry: Lane | Task, why: string, next: string): Letter {
    return mail(
      "held",
      [entry.id, hash(why)],
      waited(entry, `${"lane" in entry ? "it has not started" : "it is not open"}: ${why}`),
      next,
    );
  },

  /** Sent past the outbox, cutting a running turn short: to the Lead of `lane`, or else the Peer of `task`. */
  onHold(lane: Lane, reason: string, task?: Task): Letter {
    const what = task
      ? `HOLD: the work on ${task.id} is stopped: ${reason}`
      : `HOLD ${lane.id} (${lane.title}): the owner has stopped this lane: ${reason}`;
    return mail(
      "hold",
      [lane.id, task?.id ?? "lead", hash(reason)],
      what,
      "Stop where you are and end your turn now; start nothing and send nothing until you are told it resumes.",
    );
  },

  resumed(lane: Lane, note: string, task?: Task): Letter {
    const what = task
      ? `RESUMED: the work on ${task.id} goes on.`
      : `RESUMED ${lane.id} (${lane.title}): the owner lifted the hold.`;
    return mail(
      "resumed",
      [lane.id, task?.id ?? "lead", Date.now()],
      note ? `${what}\n\n${note}` : what,
      "Carry on from where you stopped.",
    );
  },

  /** A task beside others whose lane stopped on conflicts as it was brought in at hand-back: its Peer settles them, and nothing waits on its Lead. */
  settling(task: Task, lane: string, conflicts: string[], by: string[]): Letter {
    const text = `SETTLING ${task.id} (${task.title}): bringing ${lane} into its branch conflicts in ${conflicts.join(", ")}${by.length > 0 ? `, changed there by ${by.join(", ")}` : ""}. Its Peer settles it in its own copy before it hands back.`;
    return fyi(mail("settling", [task.id, Date.now()], text, "Nothing now: its hand-back arrives as mail."));
  },

  /** A task started beside the one at work in the lane's copy after that one's brief was written: what it holds is no longer the Peer's to write. */
  beside(started: Task): Letter {
    return mail(
      "beside",
      [started.id],
      `BESIDE ${started.id} (${started.title}) now runs beside you in a copy of its own and holds ${started.holds.join(", ")}.`,
      "Leave that to it, and ask your Lead if your goal needs it.",
    );
  },

  started(task: Task, what: string): Letter {
    return fyi(mail("started", [task.id], waited(task, what), "Nothing now: its hand-back arrives as mail."));
  },

  opened(lane: Lane, what: string): Letter {
    return fyi(mail("opened", [lane.id], waited(lane, what), "Nothing now."));
  },
};
