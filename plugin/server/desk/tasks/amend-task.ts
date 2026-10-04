import { DECIDED, OWES_HANDBACK } from "../../domain/task.ts";
import type { Lane } from "../../domain/lane.ts";
import { laneTask } from "../access.ts";
import { type Args, type Caller, type ToolReply, given, no, ok, str } from "../context.ts";
import { repeatsIncident } from "../store/incidents.ts";
import { type Amendment, amend } from "../../domain/amendment.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { workLetters } from "../letters/work-letters.ts";
import { tellMoment } from "../watch/moments.ts";
import { serialIn } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { startWaiting } from "../waiting/tasks.ts";
import { afterIds, taskAfterProblem } from "../waiting/rules.ts";
import { hintedNote, outsideNote, parallelProblem } from "./placement.ts";
import { workRoleFor } from "./add-tasks.ts";

type Changes = Record<string, string | string[]>;

type Amended = { task: Task; amendment: Amendment; note?: string };

/** Where a task not yet started runs and which role takes it, as the Lead asks them changed. */
type Moves = { parallel?: boolean; role?: string };

/** Changes what a task asks while its Peer works, keeping what it asked before; the Peer is told at its next turn, not cut off. */
export async function amendTask(desk: DeskServices, caller: Caller, args: Args): Promise<ToolReply> {
  const changes = given(args, ["goal", "context"], ["acceptance", "outOfScope", "hints", "holds", "after"]);
  if (changes.after) changes.after = afterIds(changes.after as string[]);
  const ready = await checked(desk, caller, args, changes);
  if (typeof ready === "string") return no(ready);
  const done = record(desk, caller, args, changes, ready);
  if (typeof done === "string") return no(done);
  recordEvent(caller.project, {
    kind: "task.amended",
    task: done.task.id,
    fields: Object.keys(done.amendment.was),
    by: caller.id,
  });
  await tellMoments(desk, caller, str(args.why), done);
  const note = done.note ? ` Note: ${done.note}` : "";
  if (done.task.status === "waiting") {
    // What it waits for changed: it may start now, or be held for a new reason.
    if (done.amendment.was.after || done.amendment.was.mode) await startWaiting(desk, caller.project, true);
    return ok(`${done.task.id} is amended; it starts as it is now.${note}`);
  }
  const waits = done.task.held ? done.task.after : undefined;
  const letter = workLetters.amended(done.task, done.amendment, "worker", undefined, waits);
  const posted = await desk.mail.post(done.task.peer, letter);
  const told =
    posted === "nobody"
      ? ", and it has no Peer to tell"
      : waits
        ? `; its Peer waits for ${waits.join(", ")} unnudged, and is told when they land`
        : "; its Peer has it at its next turn";
  return ok(`${done.task.id} is amended${told}.${note}`);
}

/** Why the amendment is refused before anything is written; else the role asked for, by its name, and the one-writer paths its new holds are checked against. */
async function checked(
  desk: DeskServices,
  caller: Caller,
  args: Args,
  changes: Changes,
): Promise<{ serial: string[]; moves: Moves } | string> {
  const asked = laneTask(loadLedger(caller.project.state), caller, str(args.task));
  if (typeof asked === "string") return { serial: [], moves: {} };
  const said = [str(args.why), ...Object.values(changes).flat()];
  const refused = repeatsIncident(caller.project.state, asked.task.peer, ...said);
  if (refused) return refused;
  const named = str(args.role);
  const role = named
    ? workRoleFor(desk.kit, desk.teamFor(caller.project), { ...args, skills: asked.task.skills })
    : undefined;
  if (typeof role === "string") return role;
  const moves: Moves = {
    ...(typeof args.parallel === "boolean" ? { parallel: args.parallel } : {}),
    ...(role ? { role: role.role } : {}),
  };
  if (changes.holds === undefined || !(moves.parallel ?? asked.task.mode === "parallel")) return { serial: [], moves };
  if (changes.holds.length === 0)
    return "A task beside others keeps at least one held path; give every path it holds now.";
  return { serial: await serialIn(desk.kit, caller.project, asked.lane.worktree ?? caller.project.root), moves };
}

/** What the amendment sets: paths given a task in the lane's copy to hold go among its hints, which that copy's one writer reads, and so do a parallel task's when it moves there. */
function asAsked(task: Task, changes: Changes, parallel: boolean): { set: Changes; hinted?: string[] } {
  const moving: Changes = parallel !== (task.mode === "parallel") ? { mode: parallel ? "parallel" : "lane" } : {};
  const holds = (changes.holds as string[] | undefined) ?? (moving.mode ? task.holds : undefined);
  if (parallel || holds === undefined) return { set: { ...changes, ...moving } };
  const { holds: _, ...rest } = changes;
  const hints = [...new Set([...((changes.hints as string[] | undefined) ?? task.hints), ...holds])];
  return { set: { ...rest, ...moving, hints, ...(moving.mode ? { holds: [] } : {}) }, hinted: holds };
}

/** Why a task cannot move or change role: only one not yet started can, a kept Peer works in the lane's copy, and one beside others holds a path. */
function moveProblem(task: Task, moves: Moves, holds: string[] | undefined): string | undefined {
  if (moves.parallel === undefined && moves.role === undefined) return undefined;
  if (task.status !== "waiting")
    return `${task.id} is ${task.status}: parallel and role change only a task not yet started; cut it and add it again.`;
  if (moves.parallel && task.opening?.peer && moves.role === undefined)
    return `${task.id} starts on the Peer kept from ${task.opening.peer}, which works in the lane's copy; name a role to let it go.`;
  if (moves.parallel && (holds ?? task.holds).length === 0)
    return `A task beside others holds at least one path; give ${task.id} its holds with parallel.`;
  return undefined;
}

/** Puts a moved task where it now runs, and the role asked for on what it starts with; a new role lets go of the kept Peer it named. */
function placeMoved(task: Task, lane: Lane, moves: Moves, amendment: Amendment | undefined, by: string, why: string) {
  if (amendment?.was.mode) {
    task.worktree = task.mode === "parallel" ? undefined : lane.worktree;
    task.slot = task.mode === "parallel" ? undefined : lane.slot;
  }
  const was = task.opening?.role;
  if (!moves.role || moves.role === was) return amendment;
  task.opening = { role: moves.role, peer: undefined };
  if (amendment) {
    amendment.was.role = was ?? "";
    return amendment;
  }
  const made: Amendment = { at: Date.now(), by, why, was: { role: was ?? "" } };
  task.amended = [...(task.amended ?? []), made];
  return made;
}

function record(
  { ledgers }: Pick<DeskServices, "ledgers">,
  caller: Caller,
  args: Args,
  changes: Changes,
  { serial, moves }: { serial: string[]; moves: Moves },
): Amended | string {
  return ledgers.transact(caller.project, (ledger) => {
    const found = laneTask(ledger, caller, str(args.task));
    if (typeof found === "string") return found;
    const { lane, task } = found;
    if (DECIDED.includes(task.status)) return `${task.id} is ${task.status}; start a task for what is asked now.`;
    const moved = moveProblem(task, moves, changes.holds as string[] | undefined);
    if (moved) return moved;
    const { set, hinted } = asAsked(task, changes, moves.parallel ?? task.mode === "parallel");
    // Checked as a start is, where it is written: holding more, a task beside others could hold what another does.
    const holds = set.holds as string[] | undefined;
    const problem =
      holds !== undefined && task.status !== "waiting"
        ? parallelProblem(ledger, lane, holds, serial, task.id)
        : undefined;
    if (problem) return `${problem.why} Leave those paths out of ${task.id}.`;
    const reordered = changes.after ? taskAfterProblem(ledger, task, changes.after as string[]) : undefined;
    if (reordered) return reordered;
    const amendment = placeMoved(
      task,
      lane,
      moves,
      amend(task, set, caller.id, str(args.why)),
      caller.id,
      str(args.why),
    );
    if (!amendment) return `Nothing about ${task.id} would change; pass the fields it asks differently now.`;
    task.updatedAt = Date.now();
    if (amendment.was.after) delete task.held;
    if (amendment.was.after && OWES_HANDBACK.includes(task.status) && task.after?.length)
      task.held = { why: `waits for ${task.after.join(", ")}` };
    const note = hinted ? hintedNote(task.id, hinted) : holds && outsideNote(lane, task.id, holds);
    return { task: { ...task }, amendment, note };
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
