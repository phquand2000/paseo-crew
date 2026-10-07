import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { namedOrNot, roleNamed, roleThatCan } from "../../catalog/kit/roles.ts";
import { errorText } from "../../core/errors.ts";
import { switchTo } from "../../core/git.ts";
import { clip } from "../../core/text.ts";
import { IN_HAND, TASK } from "../../domain/task.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { laneTask } from "../access.ts";
import { workKey } from "../claims.ts";
import { type Caller, type ToolReply, no, ok, str } from "../context.ts";
import { holderOf } from "../copies/holder.ts";
import { holdRefusal } from "../lanes/hold.ts";
import { besideOf, reseatBrief } from "../letters/briefs.ts";
import type { Project } from "../project/project.ts";
import { letGo } from "../seats/gone.ts";
import { seatTitle } from "../seats/names.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { loadLedger } from "../store/ledger.ts";

type ReseatCall = { task: string; why: string; role?: string };
type Copy = { id?: string; path: string; workspaceId?: string };
type Claimed = { lane: Lane; task: Task; role: string; copy: Copy };

const KEPT = 3;
const RECORD_CHARS = 2500;

/** Lets a task's Peer go and starts a fresh one on the same branch and copy, to carry on from what the last one left. */
export async function reseatTask(desk: DeskServices, caller: Caller, args: ReseatCall): Promise<ToolReply> {
  const { project } = caller;
  const claimed = claim(desk, caller, str(args.task), args.role?.trim() ?? "");
  if (typeof claimed === "string") return no(claimed);
  const { task, copy } = claimed;
  try {
    await letGo(desk, desk.roster, project, task.peer, true);
    if (task.peer) recordEvent(project, { kind: "seat.released", seat: task.peer, of: task.id });
    const started = await start(desk, caller, claimed, str(args.why));
    if (typeof started === "string")
      return no(`The engineer on ${task.id} was let go, but ${started} Reseat it again, or cut it.`);
    bind(desk, project, claimed, started.peer);
    recordEvent(project, {
      kind: "task.started",
      task: task.id,
      peer: started.peer,
      mode: task.mode,
      slot: copy.id ?? "in place",
    });
    return ok(
      `${task.id} has a fresh engineer ${started.peer} on ${task.branch}, told to carry on from what was left there.`,
    );
  } finally {
    desk.seating.release(workKey(project, task.id));
  }
}

/** Checks the task can take a fresh Peer and claims it under the lock, or says why not. */
function claim(
  { kit, ledgers, seating }: Pick<DeskServices, "kit" | "ledgers" | "seating">,
  caller: Caller,
  id: string,
  asked: string,
): Claimed | string {
  return ledgers.transact(caller.project, (ledger): Claimed | string => {
    const found = laneTask(ledger, caller, id);
    if (typeof found === "string") return found;
    const { lane, task } = found;
    if (task.kind === "review") return `${task.id} is a review: cut it and start_review again for a fresh reader.`;
    const held = holdRefusal(lane);
    if (held) return held;
    if (!IN_HAND.includes(task.status))
      return `${task.id} is ${task.status}; only a task in hand has an engineer to replace.`;
    const copy = copyOf(ledger, lane, task);
    if (typeof copy === "string") return copy;
    const named = asked || ledger.agents[task.peer ?? ""]?.role;
    const role = roleThatCan(kit, "write", named);
    if (!role) return namedOrNot(kit, "write", named ?? "", "take a task");
    if (!seating.take(workKey(caller.project, task.id)))
      return `${task.id} is already having an engineer started; read status in a moment.`;
    return { lane, task: { ...task }, role: role.role, copy };
  });
}

/** Where the fresh Peer works: the task's own copy, or the lane's while no other task holds it. */
function copyOf(ledger: Ledger, lane: Lane, task: Task): Copy | string {
  if (task.mode === "parallel") {
    const slot = task.slot ? ledger.slots[task.slot] : undefined;
    if (slot?.task !== task.id || slot.releasing)
      return `The copy ${task.id} worked in is gone or being put away: cut it and add it again.`;
    return slot;
  }
  const holder = holderOf(ledger, lane, task.id);
  if (holder)
    return `${holder.id} holds the lane's working copy now; a fresh engineer on ${task.id} in there would put two writers in one checkout. Accept or cut ${holder.id} first.`;
  return lane.slot ? ledger.slots[lane.slot]! : { path: lane.worktree!, workspaceId: lane.workspaceId };
}

async function start(
  { kit, agents }: Pick<DeskServices, "kit" | "agents">,
  caller: Caller,
  { lane, task, role, copy }: Claimed,
  why: string,
): Promise<{ peer: string } | string> {
  try {
    if (task.mode !== "parallel") {
      const refused = await switchTo(copy.path, task.branch!, task.startSha ?? lane.branch);
      if (refused) return `the lane's working copy could not go onto ${task.branch}: ${refused}.`;
    }
    const now = loadLedger(caller.project.state);
    const peer = await agents.start(caller.project, copy, role, {
      parent: caller.id,
      title: seatTitle.of(task, roleNamed(kit, role)!),
      prompt: reseatBrief(task, lane, besideOf(now, task), why, recordOf(caller.project, now, task)),
      labels: { "crew.lane": lane.id, "crew.task": task.id, "crew.role": role },
    });
    return { peer };
  } catch (error) {
    return `the fresh engineer could not start: ${errorText(error)}.`;
  }
}

/** Binds the fresh Peer; a task it cannot carry on as handed back goes to rework, one whose Peer was lost runs again. */
function bind({ ledgers }: Pick<DeskServices, "ledgers">, project: Project, claimed: Claimed, peer: string): void {
  const { lane, task, role } = claimed;
  ledgers.transact(project, (ledger) => {
    const entry = ledger.tasks[task.id];
    if (entry) {
      if (entry.status === "stalled") TASK.move(entry, "resume");
      else if (entry.status === "done" || entry.status === "failed") TASK.move(entry, "rework");
      Object.assign(entry, { peer, silent: 0, updatedAt: Date.now() });
      delete entry.peerGone;
    }
    ledger.agents[peer] = { id: peer, role, lane: lane.id, task: task.id };
  });
}

/** The last hand-backs of a task and of the reviews of it, oldest first: what came before, for the fresh Peer to check. */
function recordOf(project: Project, ledger: Ledger, task: Task): string[] {
  const dir = join(project.state, "handbacks");
  const own = new RegExp(`^${task.id}-(\\d+)\\.md$`);
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => own.test(name));
  } catch {
    // No hand-back was ever written in this project, so there is no folder to read.
  }
  const stamp = (name: string) => Number(own.exec(name)?.[1] ?? 0);
  const handbacks = names.sort((a, b) => stamp(a) - stamp(b)).map((name) => join(dir, name));
  const reviews = Object.values(ledger.tasks)
    .filter((entry) => entry.kind === "review" && entry.of === task.id && entry.handback)
    .sort((a, b) => a.handback!.at - b.handback!.at)
    .map((entry) => entry.handback!.file);
  return [...handbacks.slice(-KEPT), ...reviews.slice(-KEPT)].flatMap((file) => {
    try {
      return [clip(readFileSync(file, "utf8").trim(), RECORD_CHARS)];
    } catch {
      // A hand-back swept away meanwhile has nothing left to say.
      return [];
    }
  });
}
