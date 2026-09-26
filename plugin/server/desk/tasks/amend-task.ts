import { DECIDED } from "../../domain/task.ts";
import { laneTask } from "../access.ts";
import { type Args, type Caller, type ToolReply, given, no, ok, str } from "../context.ts";
import { repeatsIncident } from "../store/incidents.ts";
import { type Amendment, amend } from "../../domain/amendment.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { letters } from "../letters/letters.ts";
import { tellMoment } from "../watch/moments.ts";
import { serialIn } from "../project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { parallelProblem } from "./placement.ts";

type Changes = Record<string, string | string[]>;

type Amended = { task: Task; amendment: Amendment };

/** Changes what a task asks while its Peer works, keeping what it asked before; the Peer is told at its next turn, not cut off. */
export async function amendTask(desk: DeskServices, caller: Caller, args: Args): Promise<ToolReply> {
  const changes = given(args, ["goal", "context"], ["acceptance", "outOfScope", "hints", "holds"]);
  const serial = await checked(desk, caller, args, changes);
  if (typeof serial === "string") return no(serial);
  const done = record(desk, caller, args, changes, serial);
  if (typeof done === "string") return no(done);
  recordEvent(caller.project, {
    kind: "task.amended",
    task: done.task.id,
    fields: Object.keys(done.amendment.was),
    by: caller.id,
  });
  await tellMoments(desk, caller, str(args.why), done);
  if (done.task.status === "waiting") return ok(`${done.task.id} is amended; it starts as it is now.`);
  const posted = await desk.mail.post(done.task.peer, letters.amended(done.task, done.amendment, "worker"));
  const told = posted === "nobody" ? ", and it has no Peer to tell" : "; its Peer has it at its next turn";
  return ok(`${done.task.id} is amended${told}.`);
}

/** Why the amendment is refused before anything is written, or the one-writer paths its new holds are checked against. */
async function checked(desk: DeskServices, caller: Caller, args: Args, changes: Changes): Promise<string[] | string> {
  if (changes.goal === "" || changes.acceptance?.length === 0)
    return "A task keeps a goal and at least one acceptance line; give what it asks now.";
  const asked = laneTask(loadLedger(caller.project.state), caller, str(args.task));
  if (typeof asked === "string") return [];
  const said = [str(args.why), ...Object.values(changes).flat()];
  const refused = repeatsIncident(caller.project.state, asked.task.peer, ...said);
  if (refused) return refused;
  if (changes.holds === undefined) return [];
  if (asked.task.mode !== "parallel")
    return `${asked.task.id} works in the lane's copy, one writer at a time, so it holds nothing: point it with hints instead.`;
  if (changes.holds.length === 0)
    return "A task beside others keeps at least one held path; give every path it holds now.";
  return serialIn(desk.kit, caller.project, asked.lane.worktree ?? caller.project.root);
}

function record(
  { ledgers }: Pick<DeskServices, "ledgers">,
  caller: Caller,
  args: Args,
  changes: Changes,
  serial: string[],
): Amended | string {
  return ledgers.transact(caller.project, (ledger) => {
    const found = laneTask(ledger, caller, str(args.task));
    if (typeof found === "string") return found;
    const { lane, task } = found;
    if (DECIDED.includes(task.status)) return `${task.id} is ${task.status}; start a task for what is asked now.`;
    // Checked as a start is, where it is written: holding more, a task beside others could hold what another does.
    const holds = changes.holds as string[] | undefined;
    const problem =
      holds !== undefined && task.status !== "waiting"
        ? parallelProblem(ledger, lane, holds, serial, task.id)
        : undefined;
    if (problem) return `${problem.why} Leave those paths out of ${task.id}.`;
    const amendment = amend(task, changes, caller.id, str(args.why));
    if (!amendment) return `Nothing about ${task.id} would change; pass the fields it asks differently now.`;
    task.updatedAt = Date.now();
    return { task: { ...task }, amendment };
  });
}

/** A task widened past what it held settles structure; one whose goal changed turns sharply: whoever supervises hears. */
async function tellMoments(
  desk: DeskServices,
  caller: Caller,
  why: string,
  { task, amendment }: Amended,
): Promise<void> {
  const { was } = amendment;
  const widened = Array.isArray(was.holds) ? task.holds.filter((path) => !was.holds!.includes(path)) : [];
  if (widened.length > 0)
    await tellMoment(
      desk,
      caller.project,
      task,
      "ARCHITECTURE",
      `its Lead widened what it holds by ${widened.join(", ")}, because ${why}`,
    );
  if (typeof was.goal === "string")
    await tellMoment(
      desk,
      caller.project,
      task,
      "TURNING",
      `its Lead changed what it is for, because ${why}\nwas: ${was.goal}\nnow: ${task.goal}`,
    );
}
