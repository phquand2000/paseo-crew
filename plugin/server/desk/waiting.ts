import { branchExists, currentBranch, headSha } from "../core/git.ts";
import { LANE } from "../domain/lane.ts";
import { AT_WORK, TASK } from "../domain/task.ts";
import { fetchIssue } from "./issue.ts";
import { type Lane, type Ledger, type Task, loadLedger } from "./ledger.ts";
import { fyi, letters } from "./letters.ts";
import { holderOf } from "./holder.ts";
import { type Refusal, forgetPlace, leadSeatOf, openedReply, placement, seatingKey, startLead, startPeer, taskPlacement } from "./opening.ts";
import { type Project, serialIn } from "./project.ts";
import type { DeskServices } from "./services.ts";

/** The one rule for `after`, lanes and tasks alike: each must exist, one done counts, one dropped holds, the rest are waited for. */
function awaiting<T extends { id: string }>(after: string[], find: (id: string) => T | undefined, done: (entry: T) => boolean, dropped: (entry: T) => string | undefined, noun: string): T[] | string {
  const found = after.map(find);
  const missing = after.filter((_, index) => !found[index]);
  if (missing.length > 0) return `There is no ${noun} ${missing.join(", ")} to wait for.`;
  const gone = found.map((entry) => dropped(entry!)).find(Boolean);
  if (gone) return `${gone}, so nothing of it is there to build on.`;
  return found.filter((entry) => !done(entry!)) as T[];
}

/** Why a lane cannot wait on these, or the lanes of them still to land. */
export function waitsFor(ledger: Ledger, after: string[], onBranch: boolean): Lane[] | string {
  const pending = awaiting(after, (id) => ledger.lanes[id], (lane) => lane.landed === true, (lane) => (lane.status === "closed" && !lane.landed ? `Lane ${lane.id} closed without landing` : undefined), "lane");
  if (typeof pending === "string") return pending;
  // A branch carried on merges nowhere: a lane opened off the base after it would not have its work.
  const carried = after.map((id) => ledger.lanes[id]!).find((lane) => lane.onBranch);
  if (carried && !onBranch) return `Lane ${carried.id} carries on ${carried.branch} and merges nowhere, so a lane waiting for it carries on that branch too: pass onBranch.`;
  return pending;
}

/** Why a task cannot wait on these, or the tasks of them still to be merged; only code tasks of its own lane count. */
export function taskWaitsFor(ledger: Ledger, lane: string, after: string[]): Task[] | string {
  const find = (id: string) => (ledger.tasks[id]?.lane === lane && ledger.tasks[id].kind === "code" ? ledger.tasks[id] : undefined);
  return awaiting(after, find, (task) => task.status === "merged", (task) => (task.status === "cut" ? `${task.id} was cut` : undefined), "task in this lane");
}

/** Why a lane or task cannot start yet, and what whoever it waits for can do about it; the record keeps both as one reason. */
type Holding = { why: string; next: string; tried?: true };

/** Keeps why a lane or task still waits, and tells whoever asked for it, once per reason, unless it was told already. */
async function hold(desk: DeskServices, project: Project, entry: Lane | Task, holding: Holding, tell = true): Promise<void> {
  const task = "lane" in entry;
  const why = `${holding.why} ${holding.next}`;
  const changed = desk.ctx.transact(project, (current) => {
    const kept = task ? current.tasks[entry.id] : current.lanes[entry.id];
    if (!kept || kept.status !== "waiting" || kept.held?.why === why) return false;
    kept.held = { why, ...(holding.tried ? { tried: true } : {}) };
    return true;
  });
  if (!changed) return;
  desk.ctx.event(project, task ? { kind: "task.held", task: entry.id, reason: why } : { kind: "lane.held", lane: entry.id, reason: why });
  if (!tell) return;
  const to = task ? loadLedger(project.state).lanes[entry.lane]?.lead : await desk.roster.supervisorFor(project, entry.opener);
  await desk.ctx.post(to, letters.held(entry, holding.why, holding.next));
}

/**
 * Opens each waiting lane whose lanes have all landed; one that cannot, or waits on a lane dropped, is told once per reason.
 * A lane whose start was tried and failed is tried again only when `retryHeld`: a closing lane frees what held it, a round does not.
 */
export async function openWaiting(desk: DeskServices, project: Project, retryHeld: boolean): Promise<void> {
  await putBackHalfOpen(desk, project);
  const ledger = loadLedger(project.state);
  for (const waiting of Object.values(ledger.lanes).filter((lane) => lane.status === "waiting" && !lane.onHold && (retryHeld || !lane.held?.tried))) {
    const pending = waitsFor(ledger, waiting.after ?? [], waiting.onBranch === true);
    if (Array.isArray(pending) && pending.length > 0) continue;
    const held = typeof pending === "string" ? { why: pending, next: "Close this lane to drop it, or close it and open the work again without waiting." } : await release(desk, project, waiting);
    if (held) await hold(desk, project, waiting, held);
  }
}

/**
 * The same for tasks, in open lanes: a merged or cut task frees what held one, a round does not. The tasks in
 * `answered` belong to the call running this, whose reply already says what became of each, so no letter repeats it.
 */
export async function startWaiting(desk: DeskServices, project: Project, retryHeld: boolean, answered: ReadonlySet<string> = new Set()): Promise<void> {
  await putBackHalfStarted(desk, project);
  const ledger = loadLedger(project.state);
  for (const waiting of Object.values(ledger.tasks).filter((task) => task.status === "waiting" && (retryHeld || !task.held?.tried))) {
    const lane = ledger.lanes[waiting.lane];
    if (lane?.status !== "open" || !lane.lead || lane.onHold) continue;
    const pending = taskWaitsFor(ledger, lane.id, waiting.after ?? []);
    if (Array.isArray(pending) && pending.length > 0) continue;
    const told = !answered.has(waiting.id);
    const held = typeof pending === "string" ? { why: pending, next: "Cut this task to drop it, or cut it and start the work again without waiting." } : await releaseTask(desk, project, lane, waiting, told);
    if (held) await hold(desk, project, waiting, held, told);
  }
}

/** As `release`, for a task: placed and claimed in one transaction, and back to waiting if its Peer cannot start. Every task gets a Peer of its own. */
async function releaseTask(desk: DeskServices, project: Project, lane: Lane, task: Task, told: boolean): Promise<Holding | undefined> {
  const parallel = task.mode === "parallel";
  const serial = parallel ? await serialIn(desk.ctx.kit, project, lane.worktree!) : [];
  const startSha = parallel ? undefined : await headSha(lane.worktree!, lane.branch);
  const claimed = desk.ctx.transact(project, (ledger): Task | Refusal | undefined => {
    const entry = ledger.tasks[task.id];
    const now = ledger.lanes[lane.id];
    if (!entry || !now || now.onHold || !TASK.may(entry.status, "start")) return undefined;
    const problem = taskPlacement(ledger, now, entry.holds, parallel, serial);
    if (problem) return problem;
    TASK.move(entry, "start");
    Object.assign(entry, { startSha, updatedAt: Date.now() });
    desk.ctx.seating.add(seatingKey(project, entry.id));
    return { ...entry };
  });
  if (!claimed) return undefined;
  if ("why" in claimed) return { why: claimed.why, next: "It starts by itself once that clears; amend it, or cut it to drop it." };
  const started = await startPeer(desk, project, lane, claimed, { role: claimed.opening!.role, parent: lane.lead, failed: "wait" });
  if (typeof started === "string") return { why: started, next: "It is tried again when a task is merged or cut; cut it to drop it.", tried: true };
  desk.ctx.setTask(project, task.id, (entry) => {
    delete entry.held;
  });
  if (told) await desk.ctx.post(lane.lead, letters.started(claimed, `Started ${task.id} ${started.where} with Peer ${started.peer}.`));
  // The lane's copy has one writer, briefed before this task held anything: what it holds is news to that Peer, now if it is at work.
  const writer = parallel ? holderOf(loadLedger(project.state), lane) : undefined;
  if (writer?.peer) await desk.ctx.post(writer.peer, AT_WORK.includes(writer.status) ? letters.beside(claimed) : fyi(letters.beside(claimed)));
  return undefined;
}

/** Placed and claimed in one transaction, so a round can ask every time and nothing opens it twice or beside another in one copy. */
async function release(desk: DeskServices, project: Project, lane: Lane): Promise<Holding | undefined> {
  const here = await currentBranch(project.root);
  const moved = lane.onBranch && here !== lane.branch
    ? `it carries on ${lane.branch}, and the project's own copy is on ${here ?? "no branch"} now.`
    : !lane.onBranch && !(await branchExists(project.root, lane.base))
      ? `its base branch ${lane.base} no longer exists.`
      : undefined;
  const serial = moved ? [] : await serialIn(desk.ctx.kit, project, project.root);
  const placed = moved ?? desk.ctx.transact(project, (ledger): { claimed: Lane; ownCopy: boolean } | Refusal | undefined => {
    const entry = ledger.lanes[lane.id];
    if (!entry || entry.onHold || !LANE.may(entry.status, "open")) return undefined;
    const where = placement(ledger, entry, entry.opening?.isolate === true, serial, entry.id);
    if ("why" in where) return where;
    LANE.move(entry, "open");
    desk.ctx.seating.add(seatingKey(project, lane.id));
    return { claimed: { ...entry }, ownCopy: where.ownCopy };
  });
  if (!placed) return undefined;
  if (typeof placed === "string" || "why" in placed) return { why: typeof placed === "string" ? placed : placed.why, next: "It opens by itself once that clears; amend it, or close it to drop it." };
  const { claimed } = placed;
  const fetched = claimed.issue ? await fetchIssue(claimed.issue, project.root) : undefined;
  const issue = fetched && !("error" in fetched) ? fetched : undefined;
  const started = await startLead(desk, project, claimed, { ownCopy: placed.ownCopy, failed: "wait", role: claimed.opening?.role, parent: claimed.opener, issue });
  if (typeof started === "string") return { why: started, next: "It is tried again when a lane closes; close it to drop it.", tried: true };
  desk.ctx.transact(project, (ledger) => {
    const entry = ledger.lanes[lane.id];
    if (entry) delete entry.held;
  });
  await desk.ctx.post(await desk.roster.supervisorFor(project, claimed.opener), letters.opened(claimed, openedReply(project, claimed, started.slot, started.lead, issue, started.elsewhere)));
  return undefined;
}

/**
 * A task running with no Peer that nothing is seating was left so by a stop. A Peer Paseo had already started is taken
 * on; otherwise a task that waited goes back to waiting and starts again, and one started outright is cut, its Lead told.
 */
async function putBackHalfStarted(desk: DeskServices, project: Project): Promise<void> {
  const { ctx, slots, roster } = desk;
  const halfStarted = (ledger: Ledger) => Object.values(ledger.tasks).filter((task) => task.status === "running" && !task.peer && !ctx.seating.has(seatingKey(project, task.id)));
  if (halfStarted(loadLedger(project.state)).length === 0) return;
  const seats = await roster.open();
  const stopped = ctx.transact(project, (ledger) =>
    halfStarted(ledger).flatMap((task) => {
      const seat = seats.find((entry) => !entry.archivedAt && entry.labels?.["seatworks.project"] === project.slug && entry.labels["seatworks.task"] === task.id);
      if (seat) {
        task.peer = seat.id;
        ledger.agents[seat.id] = { id: seat.id, role: seat.labels!["seatworks.role"] ?? "peer", lane: task.lane, task: task.id };
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
    ctx.event(project, { kind: "task.halfStarted", task: task.id, now: task.status });
    if (task.status === "cut") await ctx.post(loadLedger(project.state).lanes[task.lane]?.lead, letters.notStarted(task));
  }
}

/**
 * A lane open with no Lead that nothing is seating was left so by a stop. A Lead Paseo had already started is taken on;
 * otherwise what the lane took goes back, and it waits again or, its open_lane never answered, closes.
 */
async function putBackHalfOpen(desk: DeskServices, project: Project): Promise<void> {
  const { ctx, slots, roster } = desk;
  const halfOpen = (ledger: Ledger) => Object.values(ledger.lanes).filter((lane) => lane.status === "open" && !lane.lead && !ctx.seating.has(seatingKey(project, lane.id)));
  if (halfOpen(loadLedger(project.state)).length === 0) return;
  const seats = await roster.open();
  const stopped = ctx.transact(project, (ledger) =>
    halfOpen(ledger).map((lane) => {
      const slot = Object.values(ledger.slots).find((entry) => entry.lane === lane.id);
      const lead = leadSeatOf(seats, project, lane.id);
      if (lead) {
        lane.lead = lead.id;
        ledger.agents[lead.id] = { id: lead.id, role: lead.labels!["seatworks.role"] ?? "lead", lane: lane.id };
      } else {
        LANE.move(lane, lane.after ? "wait" : "close");
        delete lane.held;
        forgetPlace(lane);
      }
      return { lane: { ...lane }, slot: slot?.id };
    }),
  );
  for (const { lane, slot } of stopped) {
    if (!lane.lead && slot) await slots.release(project, slot, lane.branch, lane.base);
    else if (!lane.lead && !lane.onBranch && (await currentBranch(project.root)) === lane.branch) await slots.giveBack(project, lane.base, lane.branch);
    ctx.event(project, { kind: "lane.halfOpen", lane: lane.id, status: lane.status, lead: lane.lead ?? null });
    if (lane.status !== "waiting") await ctx.post(await roster.supervisorFor(project, lane.opener), letters.halfOpen(lane));
  }
}
