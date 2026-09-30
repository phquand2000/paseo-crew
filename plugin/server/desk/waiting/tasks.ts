import { headSha } from "../../core/git.ts";
import { midTurn } from "../../core/paseo.ts";
import { AT_WORK, TASK } from "../../domain/task.ts";
import { workKey } from "../claims.ts";
import { holderOf } from "../copies/holder.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger, readLedger } from "../store/ledger.ts";
import { fyi } from "../letters/envelope.ts";
import { workLetters } from "../letters/work-letters.ts";
import { seatLetters } from "../letters/seat-letters.ts";
import { type Project, serialIn } from "../project/project.ts";
import type { Refusal } from "../refusal.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { keptFor } from "../seats/kept.ts";
import { startPeer } from "../tasks/peer-seat.ts";
import { taskPlacement } from "../tasks/placement.ts";
import { type Holding, noteHeld } from "./held.ts";
import { taskWaitsFor } from "./rules.ts";

/**
 * Starts each waiting task in an open lane once what it waits for is merged; a merged or cut task frees what held one, a
 * round does not. Tasks in `answered` belong to the call running this, whose reply already says what became of each.
 */
export async function startWaiting(
  desk: DeskServices,
  project: Project,
  retryHeld: boolean,
  answered: ReadonlySet<string> = new Set(),
): Promise<void> {
  await putBackHalfStarted(desk, project);
  const ledger = loadLedger(project.state);
  const due = Object.values(ledger.tasks).filter(
    (task) => task.status === "waiting" && (retryHeld || !task.held?.tried),
  );
  for (const waiting of due) {
    const lane = ledger.lanes[waiting.lane];
    if (lane?.status !== "open" || !lane.lead || lane.onHold) continue;
    const pending = taskWaitsFor(ledger, lane.id, waiting.after ?? []);
    if (Array.isArray(pending) && pending.length > 0) continue;
    const told = !answered.has(waiting.id);
    const next = "Change what it waits for with amend_task, or cut this task to drop it.";
    const held =
      typeof pending === "string" ? { why: pending, next } : await tryStart(desk, project, lane, waiting, told);
    if (held) await noteHeld(desk, project, waiting, held, told);
  }
}

/** A task held for the turn of the kept Peer it names starts as that turn ends, not at the next round. */
export async function startAfterTurn(desk: DeskServices, agentId: string): Promise<void> {
  for (const project of desk.projects.values()) {
    const ledger = readLedger(project.state);
    const from = ledger.agents[agentId]?.task;
    const held = (task: Task) => task.status === "waiting" && !task.held?.tried && task.opening?.peer === from;
    if (from && Object.values(ledger.tasks).some(held)) await startWaiting(desk, project, false);
  }
}

/** Placed and claimed in one transaction, and back to waiting if its Peer cannot start; a Peer is new unless one kept is named. */
async function tryStart(
  desk: DeskServices,
  project: Project,
  lane: Lane,
  task: Task,
  told: boolean,
): Promise<Holding | undefined> {
  const { kit, ledgers, seating } = desk;
  const parallel = task.mode === "parallel";
  const serial = parallel ? await serialIn(kit, project, lane.worktree!) : [];
  const startSha = parallel ? undefined : await headSha(lane.worktree!, lane.branch);
  const asked = await namedPeer(desk, project, task);
  if (asked && "why" in asked) return asked;
  let kept = asked;
  const claimed = ledgers.transact(project, (ledger): Task | Refusal | undefined => {
    const entry = ledger.tasks[task.id];
    const now = ledger.lanes[lane.id];
    if (!entry || !now || now.onHold || !TASK.may(entry.status, "start")) return undefined;
    const problem = taskPlacement(ledger, now, entry.holds, parallel, serial);
    if (problem) return problem;
    if (kept && keptFor(ledger, ledger.tasks[kept.from], task.opening!.role) !== ledger.agents[kept.peer])
      kept = undefined;
    TASK.move(entry, "start");
    Object.assign(entry, { startSha, updatedAt: Date.now() });
    seating.take(workKey(project, entry.id));
    return { ...entry };
  });
  if (!claimed) return undefined;
  if ("why" in claimed)
    return { why: claimed.why, next: "It starts by itself once that clears; amend it, or cut it to drop it." };
  const started = await startPeer(desk, project, lane, claimed, {
    role: claimed.opening!.role,
    parent: lane.lead,
    kept,
  });
  if (typeof started === "string") return failedStart(project, task, kept, started);
  const named = task.opening?.peer;
  const instead = named && !kept ? ` The Peer kept from ${named} could not take it, so a new one did.` : "";
  await announce(
    desk,
    project,
    lane,
    claimed,
    told ? `Started ${task.id} ${started.where} with Peer ${started.peer}.${instead}` : undefined,
  );
  return undefined;
}

/** The Peer kept from the task its Lead named, when it is there between turns; one in a turn holds the task until it ends. */
async function namedPeer(
  desk: Pick<DeskServices, "roster">,
  project: Project,
  task: Task,
): Promise<{ peer: string; from: string } | Holding | undefined> {
  const from = task.opening?.peer;
  if (!from) return undefined;
  const ledger = loadLedger(project.state);
  const kept = keptFor(ledger, ledger.tasks[from], task.opening!.role);
  if (typeof kept === "string") return undefined;
  const look = await desk.roster.look(kept.id).catch(() => undefined);
  if (!look || look.archivedAt) return undefined;
  if (!midTurn(look.status)) return { peer: kept.id, from };
  return {
    why: `The Peer kept from ${from} is in a turn; ${task.id} starts on it once that turn ends.`,
    next: `Or release ${from}'s Peer, and a new one takes ${task.id}.`,
  };
}

/** A start that failed waits for a merge or a cut, unless the kept Peer it named is gone: a new one takes it next round. */
function failedStart(project: Project, task: Task, kept: { from: string } | undefined, why: string): Holding {
  const ledger = loadLedger(project.state);
  if (kept && typeof keptFor(ledger, ledger.tasks[kept.from], task.opening!.role) === "string")
    return { why, next: "A new Peer takes it at the desk's next round; cut it to drop it." };
  return { why, next: "It is tried again when a task is merged or cut; cut it to drop it.", tried: true };
}

/** Tells the Lead a task started, if `said`, and whoever writes in the lane's copy what a task beside it holds. */
async function announce(
  { ledgers, mail }: Pick<DeskServices, "ledgers" | "mail">,
  project: Project,
  lane: Lane,
  claimed: Task,
  said: string | undefined,
): Promise<void> {
  ledgers.setTask(project, claimed.id, (entry) => {
    delete entry.held;
  });
  if (said) await mail.post(lane.lead, workLetters.started(claimed, said));
  // The lane's copy has one writer, briefed before this task held anything: what it holds is news to that Peer, now if at work.
  const writer = claimed.mode === "parallel" ? holderOf(loadLedger(project.state), lane) : undefined;
  if (writer?.peer)
    await mail.post(
      writer.peer,
      AT_WORK.includes(writer.status) ? workLetters.beside(claimed) : fyi(workLetters.beside(claimed)),
    );
}

/**
 * A task running with no Peer that nothing is seating was left so by a stop. A Peer Paseo had already started is taken
 * on; otherwise a task that waited goes back to waiting and starts again, and one started outright is cut, its Lead told.
 */
async function putBackHalfStarted(desk: DeskServices, project: Project): Promise<void> {
  const { ledgers, mail, seating, slots, roster } = desk;
  const halfStarted = (ledger: Ledger) =>
    Object.values(ledger.tasks).filter(
      (task) => task.status === "running" && !task.peer && !seating.has(workKey(project, task.id)),
    );
  if (halfStarted(loadLedger(project.state)).length === 0) return;
  const seats = await roster.open();
  const stopped = ledgers.transact(project, (ledger) =>
    halfStarted(ledger).flatMap((task) => {
      const seat = seats.find(
        (entry) =>
          !entry.archivedAt && entry.labels?.["crew.project"] === project.slug && entry.labels["crew.task"] === task.id,
      );
      if (seat) {
        task.peer = seat.id;
        const role = seat.labels!["crew.role"] ?? "peer";
        ledger.agents[seat.id] = { id: seat.id, role, lane: task.lane, task: task.id };
        return [];
      }
      const slot = task.mode === "parallel" ? task.slot : undefined;
      TASK.move(task, task.opening ? "wait" : "cut");
      if (task.mode === "parallel") {
        delete task.slot;
        delete task.worktree;
      }
      return [{ task: { ...task }, slot, into: ledger.lanes[task.lane]?.branch }];
    }),
  );
  for (const { task, slot, into } of stopped) {
    if (slot) await slots.release(project, slot, task.branch, into);
    recordEvent(project, { kind: "task.halfStarted", task: task.id, now: task.status });
    if (task.status === "cut")
      await mail.post(loadLedger(project.state).lanes[task.lane]?.lead, seatLetters.notStarted(task));
  }
}
