import { headSha, isAncestor, landedRef, mergeBranch, mergeUnderWay } from "../core/git.ts";
import { landLane } from "../core/land.ts";
import { midTurn } from "../core/paseo.ts";
import { ASK } from "../domain/ask.ts";
import { LANE } from "../domain/lane.ts";
import { TASK } from "../domain/task.ts";
import { type ToolReply, no, ok, str } from "./context.ts";
import { laneGate } from "./gates.ts";
import { askFirstHits, changeOf, landFacts } from "./landing.ts";
import { type Lane, type Ledger, type Task, findLane, loadLedger, tasksOf } from "./ledger.ts";
import { keptLetters } from "./kept-letters.ts";
import { landLetters } from "./land-letters.ts";
import { closeIncidentsOf } from "./notice.ts";
import { type Project, loadConfig } from "./project.ts";
import type { DeskServices } from "./services.ts";
import { seatingKey } from "./opening.ts";
import { openWaiting } from "./waiting.ts";
import { midTurnAmong } from "./writing.ts";

type Closed = ToolReply & { blocked?: string };

type Closing = { lane: string; land: boolean; reason?: string; overGate?: boolean };

/**
 * Merges base into the lane in its own copy; never under a seat mid-turn there, and an unseen seat counts as writing. One that
 * stops on conflicts is left in the copy, and its Lead told to have it settled. `why` is what stops landing; `then`, what can be done.
 */
async function bringBaseIn(desk: DeskServices, project: Project, ledger: Ledger, lane: Lane): Promise<{ why: string; then: string; writers?: string[] } | undefined> {
  const { ctx, roster } = desk;
  if (!lane.worktree) return { why: `it has no working copy on record to merge ${lane.base} into`, then: "Drop it with drop_lane." };
  if (await isAncestor(lane.worktree, lane.base, lane.branch)) return undefined;
  const settle = "land_lane it again once the Lead reports it ready, or drop_lane it.";
  if (await mergeUnderWay(lane.worktree)) return { why: `the merge of ${lane.base} into ${lane.branch} left in its copy is not settled yet`, then: `Its Lead has it to settle; ${settle}` };
  // Readers count too: a merge changes the files under whoever is reading them.
  const busy = await midTurnAmong(roster, [lane.lead, ...tasksOf(ledger, lane.id).filter((task) => task.mode !== "parallel").map((task) => task.peer)]);
  if (busy.length > 0) {
    return {
      why: `${lane.base} has moved on, so landing it starts with merging ${lane.base} into ${lane.branch} in its copy, and a seat is mid-turn there`,
      then: "CAN LAND comes as mail when that turn ends; land_lane it again then, or drop_lane it.",
      writers: busy,
    };
  }
  const merged = await mergeBranch(lane.worktree, lane.base, `Bring ${lane.base} into ${lane.branch}`, true);
  if (merged.ok) return undefined;
  if (merged.conflicts.length === 0) return { why: `${lane.base} has moved on and does not merge into ${lane.branch}: ${merged.message}`, then: "Nothing was changed. Message its Lead, or drop_lane it." };
  // What it was reported ready as is not what it holds now.
  ctx.transact(project, (current) => {
    const entry = current.lanes[lane.id];
    if (entry) delete entry.ready;
  });
  await ctx.post(lane.lead, landLetters.baseConflict(lane, merged.conflicts));
  return { why: `${lane.base} has moved on and conflicts with ${lane.branch} in ${merged.conflicts.join(", ")}`, then: `The merge is left in the lane's copy, and its Lead has a letter to have it settled; ${settle}` };
}

/** What a lane lands under as one commit or a merge: its title, its outcome and the tasks that went into it. */
function landMessage(ledger: Ledger, lane: Lane): string {
  const tasks = tasksOf(ledger, lane.id).filter((task) => task.kind === "code" && task.status === "merged");
  return [`${lane.title} (${lane.id})`, "", lane.outcome, ...(tasks.length > 0 ? ["", ...tasks.map((task) => `- ${task.id} ${task.title}`)] : [])].join("\n");
}

type Held = NonNullable<Lane["landApproval"]>;

const NOT_READY = "Its Lead has not reported it ready as it now stands: never, or the lane was amended since.";

/**
 * A landing waits for the Human only where they asked to be asked first; all else the desk reads of it goes with it as
 * evidence. An approval stands for what it was given: a path they are newly asked about holds it again.
 */
async function checkLanding(desk: DeskServices, project: Project, lane: Lane, gate: { ok: boolean; ran: boolean }, overGate: boolean, approved?: Held): Promise<{ held?: string; note: string }> {
  const { ctx } = desk;
  const change = await changeOf(project, lane);
  const asks = askFirstHits(project, change);
  const evidence = [...(lane.ready ? [] : [NOT_READY]), ...(await landFacts(ctx.kit, project, loadLedger(project.state), lane, change, { set: gate.ran, ok: gate.ok }))];
  const fresh = approved ? asks.filter((ask) => !approved.signals.includes(ask)) : asks;
  if (fresh.length === 0) return { note: `\n\n${approved ? "The Human approved it.\n" : ""}Evidence: ${evidence.join(" ")}` };
  const head = (await headSha(project.root, lane.branch)) ?? "";
  ctx.transact(project, (current) => {
    const entry = current.lanes[lane.id];
    if (entry) entry.landApproval = { since: Date.now(), head, signals: asks, evidence, overGate };
  });
  ctx.event(project, { kind: "land.held", lane: lane.id, signals: asks.length });
  await ctx.post(lane.lead, landLetters.landHeld(lane, asks.join(" "), head));
  return { held: `Lane ${lane.id} was not landed: it waits for the Human's approval, on the Flow tab of the panel. ${asks.join(" ")}\n\nEvidence: ${evidence.join(" ")}\n\nYou cannot approve it; tell them it waits, and why. LANDED or SENT BACK comes as mail.`, note: "" };
}

/** Closes a lane for `by`: the Supervisor that called, or the one the Human's approval lands it for. `blocked` is what kept a landing from happening. */
export async function close(desk: DeskServices, project: Project, by: string, args: Closing): Promise<Closed> {
  const { ctx, merges } = desk;
  const ledger = loadLedger(project.state);
  const lane = findLane(ledger, str(args.lane));
  if (!lane) return no(`There is no lane ${str(args.lane)}.`);
  if (lane.status === "waiting") {
    if (args.land === true) return no(`Lane ${lane.id} never opened, so there is nothing to land; drop_lane drops it.`);
    ctx.moveLane(project, lane.id, "drop");
    ctx.event(project, { kind: "lane.closed", lane: lane.id, land: false, landing: "dropped while waiting", reason: str(args.reason), writers: [] });
    return ok(`Lane ${lane.id} was waiting and is dropped; nothing had started for it.`);
  }
  if (lane.status !== "open") return no(`Lane ${lane.id} is already closed.`);
  if (args.land === true && lane.onHold) return no(`Lane ${lane.id} is on hold: ${lane.onHold.reason}. Resume it with resume_lane before landing it.`);
  // One close of a lane at a time: a second landed it and retired it again, and both were told it closed.
  const key = seatingKey(project, lane.id);
  if (ctx.closing.has(key)) return no(`Lane ${lane.id} is already being closed by another call; read status once that call has answered.`);
  ctx.closing.add(key);
  try {
    // Wait for queued merges, one more try included for those waiting on a clean copy: they run in the copy closing gates, lands and removes.
    await merges.retry(project);
    await merges.settled(project);
    // One landing at a time moves a project's base; the next reads it again, bringing in what the last one landed.
    const landing = () => {
      const now = loadLedger(project.state);
      return land(desk, project, now, now.lanes[lane.id] ?? lane, by, args.overGate === true);
    };
    const landed = args.land === true ? await ctx.inTurn(`${project.slug}:land`, landing) : { how: `the branch ${lane.branch} is kept for the Human`, note: "" };
    if ("text" in landed) return landed;
    return await retire(desk, project, lane, args, landed);
  } finally {
    ctx.closing.delete(key);
  }
}

/** A hold with no commit since stands while it still touches what the Human asked to be asked about; asked about again, it is read again. */
async function stillHeld(desk: DeskServices, project: Project, lane: Lane, held: Held): Promise<Closed | undefined> {
  const asks = askFirstHits(project, await changeOf(project, lane));
  if (asks.length === 0) return undefined;
  desk.ctx.transact(project, (current) => {
    const entry = current.lanes[lane.id]?.landApproval;
    if (entry && !entry.approved) entry.signals = asks;
  });
  return ok(`Lane ${lane.id} still waits for the Human's approval to land, since ${Math.round((Date.now() - held.since) / 60_000)} min ago. ${asks.join(" ")} LANDED or SENT BACK comes as mail.`);
}

/** Lands an open lane for `by`, or says what kept it from landing: a hold for the Human, base that will not merge, a red gate. */
async function land(desk: DeskServices, project: Project, ledger: Ledger, lane: Lane, by: string, overGate: boolean): Promise<Closed | { how: string; note: string }> {
  const { ctx } = desk;
  const held = lane.landApproval;
  const tip = await headSha(project.root, lane.branch);
  // A commit after the hold makes it a lane nobody has looked at: it is checked again from the start.
  const approved = held?.approved && held.head === tip ? held : undefined;
  // An approval lands the lane with no call deciding it again, so a lane amended since waits for its Lead's word.
  if (approved && !lane.ready) {
    const why = "its Lead has not reported it ready as it now stands";
    return { ...no(`Lane ${lane.id} was not landed: ${why}. The Human's approval stands; land_lane lands it once its Lead reports it ready.`), blocked: why };
  }
  const waits = held && !held.approved && held.head === tip ? await stillHeld(desk, project, lane, held) : undefined;
  if (waits) return waits;
  // Land before closing: a closed lane cannot be closed again, so a landing that cannot happen is refused while open.
  const synced = await bringBaseIn(desk, project, ledger, lane);
  if (synced?.writers) {
    ctx.transact(project, (current) => {
      const entry = current.lanes[lane.id];
      if (entry) entry.landing = { by, writers: synced.writers! };
    });
  }
  if (synced) return { ...no(`Lane ${lane.id} was not closed: ${synced.why}. ${synced.then}`), blocked: synced.why };
  const merged = approved ? await headSha(project.root, lane.branch) : tip;
  // Base merged in by the desk itself is not the lane changing under an approval.
  if (approved && merged && merged !== tip) {
    ctx.transact(project, (current) => {
      const entry = current.lanes[lane.id]?.landApproval;
      if (entry) entry.head = merged;
    });
  }
  // What lands is the head its gate saw: a lane that moves after the gate lands nothing.
  const tested = await headSha(project.root, lane.branch);
  const gate = await laneGate(ctx, project, lane);
  // A red gate stops landing unless the Supervisor passes `overGate`: the verdict is evidence, not a veto.
  if (!gate.ok && !overGate) {
    return { ...no(`Lane ${lane.id} was not closed: ${gate.text}\nMessage its Lead, drop_lane it, or land_lane it over the gate with overGate true and your reason: that is your call.`), blocked: gate.text.split("\n")[0]!.replace(/\.$/, "") };
  }
  const check = await checkLanding(desk, project, lane, gate, overGate, approved);
  if (check.held) return ok(check.held);
  const how = { as: loadConfig(project.state).landAs, message: landMessage(ledger, lane), keep: landedRef(lane.id) };
  const result = lane.onBranch ? { landed: true, how: `the work stays on ${lane.branch}, the branch it carried on; nothing was merged anywhere` } : await landLane(project.root, lane.base, lane.branch, tested ?? "", how);
  if (!result.landed) return { ...no(`Lane ${lane.id} was not closed: it could not land, because ${result.how}. land_lane it again once that is cleared, or drop_lane it.`), blocked: result.how };
  if (!gate.ok) ctx.event(project, { kind: "gate.overridden", lane: lane.id, by });
  return { how: `${result.how}${gate.ok ? "" : ", over a red gate"}`, note: check.note };
}

/** Where the lane's copy stands once it closes: on a carried-on branch, kept with its Lead, going away, or the Human's going back. */
function copyNote(lane: Lane, kept: boolean, writers: string[]): string {
  if (lane.onBranch) return `The project's own copy stays on ${lane.branch}.`;
  if (lane.slot && kept) return `Its working copy ${lane.slot} stays with its Lead.`;
  const where = lane.slot ? "Its working copy is put away" : `The project's own copy goes back to ${lane.base}`;
  return writers.length > 0 ? `${where} once ${writers.join(" and ")} finish the turn they are in.` : lane.slot ? "Its working copy is put away." : `The project's own copy is back on ${lane.base}.`;
}

/** Closes the lane on record and cuts what it still had going: its Peers go, and its Lead stays with any copy of its own until released. */
async function retire(desk: DeskServices, project: Project, lane: Lane, args: Closing, landed: { how: string; note: string }): Promise<Closed> {
  const { ctx, roster, slots, agents } = desk;
  const retired = ctx.transact(project, (current) => {
    const entry = current.lanes[lane.id];
    if (entry && LANE.move(entry, "close")) Object.assign(entry, { landed: args.land === true || undefined, closedAt: Date.now() });
    delete entry?.landApproval;
    delete entry?.onHold;
    // Nobody in the lane is left to answer them, and a kept Lead would be reminded of them for nothing.
    for (const ask of Object.values(current.asks)) if (ask.lane === lane.id && ASK.move(ask, "answer")) ask.answer = `Lane ${lane.id} closed before this was answered.`;
    const tasks: Task[] = [];
    for (const task of Object.values(current.tasks).filter((item) => item.lane === lane.id)) {
      TASK.move(task, "cut");
      tasks.push({ ...task });
    }
    return tasks;
  });
  const branches: string[] = [];
  for (const task of retired) {
    const branch = await agents.retire(project, task, args.land === true ? landedRef(lane.id) : lane.branch);
    if (branch) branches.push(branch);
  }
  // A look Paseo could not answer is not a Lead gone: it stays kept, and a round that finds it gone puts its copy away.
  const look = lane.lead ? await roster.look(lane.lead).catch(() => null) : undefined;
  const kept = look === null || Boolean(look && !look.archivedAt);
  // Mid-turn seats are still writing in the lane's copy, the kept Lead included; it goes back when their turn ends, not under them.
  const peers = retired.filter((task) => task.mode !== "parallel").map((task) => task.peer).filter((id): id is string => typeof id === "string" && roster.archiving(id));
  const writers = [...new Set([...(look && !look.archivedAt && midTurn(look.status) ? [lane.lead!] : []), ...peers])];
  // A branch carried on is the Human's, and a copy of the lane's own stays with a kept Lead until it is released.
  if (!lane.onBranch && (!lane.slot || !kept)) {
    const drop = args.land === true ? { dropBranch: lane.branch, into: landedRef(lane.id) } : {};
    const branch = await slots.putAway({ project, slot: lane.slot, restore: lane.base, lane: lane.id, branch: lane.branch, ...drop }, writers);
    if (branch) branches.push(branch);
  }
  if (lane.lead) closeIncidentsOf(desk, project, lane.lead);
  if (kept) await ctx.post(lane.lead, keptLetters.closed(lane, args.land === true, landed.how));
  if (lane.detourOf) {
    const waiting = loadLedger(project.state).lanes[lane.detourOf];
    if (waiting?.status === "open" && waiting.lead) await ctx.post(waiting.lead, landLetters.detourLanded(lane, waiting, landed.how));
  }
  ctx.event(project, { kind: "lane.closed", lane: lane.id, land: args.land === true, landing: landed.how, reason: str(args.reason), writers });
  const seats = kept ? `Its Peers are archived, and its Lead ${lane.lead} stays until you release it.` : "Its Peers are archived, and its Lead is gone.";
  const held = branches.length > 0 ? ` ${branches.join(" and ")} ${branches.length === 1 ? "holds commits" : "hold commits"} nothing else has and ${branches.length === 1 ? "is" : "are"} kept.` : "";
  await openWaiting(desk, project, true);
  return ok(`Lane ${lane.id} closed; ${landed.how}. ${seats} ${copyNote(lane, kept, writers)}${held}${landed.note}`);
}

/**
 * The Human's word on a held landing. Approved, the desk lands it now for the Supervisor; what stops it (a seat mid-turn,
 * a dirty copy) leaves the approval standing for the next `land_lane`. Sent back, the lane stays open with their note.
 */
export async function decideLand(desk: DeskServices, project: Project, laneId: string, approve: boolean, note: string): Promise<ToolReply> {
  const { ctx } = desk;
  const lane = loadLedger(project.state).lanes[laneId];
  const none = no(`Lane ${laneId} has no landing waiting for your approval.`);
  if (lane?.status !== "open" || !lane.landApproval || lane.landApproval.approved) return none;
  const tip = await headSha(project.root, lane.branch);
  // Decided where it is written: two decisions at once both acted on one hold, and it landed twice.
  const decided = ctx.transact(project, (current) => {
    const entry = current.lanes[laneId];
    const held = entry?.status === "open" ? entry.landApproval : undefined;
    if (!entry || !held || held.approved) return undefined;
    const changed = held.head !== tip;
    if (approve && !changed) held.approved = { at: Date.now(), note };
    else delete entry.landApproval;
    return { held: { ...held }, changed };
  });
  if (!decided) return none;
  const { held } = decided;
  const supervisor = await desk.roster.supervisorFor(project, lane.opener);
  const tell = (how: Parameters<typeof landLetters.landDecided>[1], text: string) => ctx.post(supervisor, landLetters.landDecided(lane, how, text));
  if (decided.changed) {
    await tell("changed", "");
    return ok(`Lane ${laneId} changed after it was held, so this approval is not for what it holds now. It is checked again when the Supervisor lands it.`);
  }
  ctx.event(project, { kind: approve ? "land.approved" : "land.sentBack", lane: laneId });
  if (!approve) {
    await ctx.post(lane.lead, landLetters.landSentBack(lane, note, held.head));
    await tell("sent back", note);
    return ok(`Lane ${laneId} is sent back to its Lead with your note; it stays open.`);
  }
  const closed = await close(desk, project, supervisor ?? lane.opener, { lane: laneId, land: true, overGate: held.overGate });
  const now = loadLedger(project.state).lanes[laneId];
  const said = `${note ? `${note}. ` : ""}${closed.text}`;
  if (now?.status === "closed") {
    await tell("landed", said);
    return ok(`Approved: ${closed.text}`);
  }
  if (now?.landApproval && !now.landApproval.approved) {
    await tell("again", closed.text);
    return ok(`Approved, but landing lane ${laneId} turned up more, so it waits for you again: ${closed.text}`);
  }
  const blocked = closed.blocked ?? closed.text;
  await tell("blocked", blocked);
  return ok(`Approved. It could not land yet: ${blocked}. The Supervisor lands it once that is cleared.`);
}
