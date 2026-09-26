import { headSha } from "../../core/git.ts";
import { AT_WORK, TASK } from "../../domain/task.ts";
import { workKey } from "../claims.ts";
import { holderOf } from "../copies/holder.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { fyi } from "../letters/envelope.ts";
import { workLetters } from "../letters/work-letters.ts";
import { seatLetters } from "../letters/seat-letters.ts";
import { type Project, serialIn } from "../project.ts";
import type { Refusal } from "../refusal.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
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
    const next = "Cut this task to drop it, or cut it and start the work again without waiting.";
    const held =
      typeof pending === "string" ? { why: pending, next } : await tryStart(desk, project, lane, waiting, told);
    if (held) await noteHeld(desk, project, waiting, held, told);
  }
}

/** Placed and claimed in one transaction, and back to waiting if its Peer cannot start; every task gets a Peer of its own. */
async function tryStart(
  desk: DeskServices,
  project: Project,
  lane: Lane,
  task: Task,
  told: boolean,
): Promise<Holding | undefined> {
  const { kit, ledgers, seating, mail } = desk;
  const parallel = task.mode === "parallel";
  const serial = parallel ? await serialIn(kit, project, lane.worktree!) : [];
  const startSha = parallel ? undefined : await headSha(lane.worktree!, lane.branch);
  const claimed = ledgers.transact(project, (ledger): Task | Refusal | undefined => {
    const entry = ledger.tasks[task.id];
    const now = ledger.lanes[lane.id];
    if (!entry || !now || now.onHold || !TASK.may(entry.status, "start")) return undefined;
    const problem = taskPlacement(ledger, now, entry.holds, parallel, serial);
    if (problem) return problem;
    TASK.move(entry, "start");
    Object.assign(entry, { startSha, updatedAt: Date.now() });
    seating.take(workKey(project, entry.id));
    return { ...entry };
  });
  if (!claimed) return undefined;
  if ("why" in claimed)
    return { why: claimed.why, next: "It starts by itself once that clears; amend it, or cut it to drop it." };
  const started = await startPeer(desk, project, lane, claimed, { role: claimed.opening!.role, parent: lane.lead });
  if (typeof started === "string")
    return { why: started, next: "It is tried again when a task is merged or cut; cut it to drop it.", tried: true };
  ledgers.setTask(project, task.id, (entry) => {
    delete entry.held;
  });
  if (told)
    await mail.post(
      lane.lead,
      workLetters.started(claimed, `Started ${task.id} ${started.where} with Peer ${started.peer}.`),
    );
  // The lane's copy has one writer, briefed before this task held anything: what it holds is news to that Peer, now if at work.
  const writer = parallel ? holderOf(loadLedger(project.state), lane) : undefined;
  if (writer?.peer)
    await mail.post(
      writer.peer,
      AT_WORK.includes(writer.status) ? workLetters.beside(claimed) : fyi(workLetters.beside(claimed)),
    );
  return undefined;
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
          !entry.archivedAt &&
          entry.labels?.["seatworks.project"] === project.slug &&
          entry.labels["seatworks.task"] === task.id,
      );
      if (seat) {
        task.peer = seat.id;
        const role = seat.labels!["seatworks.role"] ?? "peer";
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
