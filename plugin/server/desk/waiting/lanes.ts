import { branchExists, currentBranch } from "../../core/git.ts";
import { LANE } from "../../domain/lane.ts";
import { workKey } from "../claims.ts";
import { fetchIssue } from "../../core/github.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { workLetters } from "../letters/work-letters.ts";
import { seatLetters } from "../letters/seat-letters.ts";
import { forgetPlace, leadSeatOf, openedReply, startLead } from "../lanes/lead-seat.ts";
import { placement } from "../lanes/placement.ts";
import { type Project, serialIn } from "../project/project.ts";
import type { Refusal } from "../refusal.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { type Holding, noteHeld } from "./held.ts";
import { waitsFor } from "./rules.ts";

/**
 * Opens each waiting lane whose lanes have all landed; one that cannot, or waits on a lane dropped, is told once per
 * reason. A lane whose start failed is tried again only when `retryHeld`: a closing lane frees what held it, a round does not.
 */
export async function openWaiting(desk: DeskServices, project: Project, retryHeld: boolean): Promise<void> {
  await putBackHalfOpen(desk, project);
  const ledger = loadLedger(project.state);
  const due = Object.values(ledger.lanes).filter(
    (lane) => lane.status === "waiting" && !lane.onHold && (retryHeld || !lane.held?.tried),
  );
  for (const waiting of due) {
    const pending = waitsFor(ledger, waiting.after ?? [], waiting.onBranch === true);
    if (Array.isArray(pending) && pending.length > 0) continue;
    const next = "Close this lane to drop it, or close it and open the work again without waiting.";
    const held = typeof pending === "string" ? { why: pending, next } : await tryOpen(desk, project, waiting);
    if (held) await noteHeld(desk, project, waiting, held);
  }
}

/** Placed and claimed in one transaction, so a round can ask every time and nothing opens it twice or beside another in one copy. */
async function tryOpen(desk: DeskServices, project: Project, lane: Lane): Promise<Holding | undefined> {
  const { kit, ledgers, seating, mail, roster } = desk;
  const moved = await branchMoved(project, lane);
  const serial = moved ? [] : await serialIn(kit, project, project.root);
  const placed =
    moved ??
    ledgers.transact(project, (ledger): { claimed: Lane; ownCopy: boolean } | Refusal | undefined => {
      const entry = ledger.lanes[lane.id];
      if (!entry || entry.onHold || !LANE.may(entry.status, "open")) return undefined;
      const where = placement(ledger, entry, entry.opening?.isolate === true, serial, entry.id);
      if ("why" in where) return where;
      LANE.move(entry, "open");
      seating.take(workKey(project, lane.id));
      return { claimed: { ...entry }, ownCopy: where.ownCopy };
    });
  if (!placed) return undefined;
  if (typeof placed === "string" || "why" in placed) {
    const why = typeof placed === "string" ? placed : placed.why;
    return { why, next: "It opens by itself once that clears; amend it, or close it to drop it." };
  }
  const { claimed, ownCopy } = placed;
  const fetched = claimed.issue ? await fetchIssue(claimed.issue, project.root) : undefined;
  const issue = fetched && !("error" in fetched) ? fetched : undefined;
  const how = { ownCopy, failed: "wait" as const, role: claimed.opening?.role, parent: claimed.opener, issue };
  const started = await startLead(desk, project, claimed, how);
  if (typeof started === "string")
    return { why: started, next: "It is tried again when a lane closes; close it to drop it.", tried: true };
  ledgers.setLane(project, lane.id, (entry) => {
    delete entry.held;
  });
  const reply = openedReply(project, claimed, started.slot, started.lead, issue, started.elsewhere);
  await mail.post(await roster.supervisorFor(project, claimed.opener), workLetters.opened(claimed, reply));
  return undefined;
}

/** Why the branch a waiting lane was to open on is not where it was: moved off, or its base gone. */
async function branchMoved(project: Project, lane: Lane): Promise<string | undefined> {
  const here = await currentBranch(project.root);
  if (lane.onBranch && here !== lane.branch)
    return `it carries on ${lane.branch}, and the project's own copy is on ${here ?? "no branch"} now.`;
  if (!lane.onBranch && !(await branchExists(project.root, lane.base)))
    return `its base branch ${lane.base} no longer exists.`;
  return undefined;
}

/**
 * A lane open with no Lead that nothing is seating was left so by a stop. A Lead Paseo had already started is taken on;
 * otherwise what the lane took goes back, and it waits again or, its open_lane never answered, closes.
 */
async function putBackHalfOpen(desk: DeskServices, project: Project): Promise<void> {
  const { ledgers, mail, seating, slots, ownCopy, roster } = desk;
  const halfOpen = (ledger: Ledger) =>
    Object.values(ledger.lanes).filter(
      (lane) => lane.status === "open" && !lane.lead && !seating.has(workKey(project, lane.id)),
    );
  if (halfOpen(loadLedger(project.state)).length === 0) return;
  const seats = await roster.open();
  const stopped = ledgers.transact(project, (ledger) =>
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
    else if (!lane.lead && !lane.onBranch && (await currentBranch(project.root)) === lane.branch)
      await ownCopy.giveBack(project, lane.base, lane.branch);
    recordEvent(project, { kind: "lane.halfOpen", lane: lane.id, status: lane.status, lead: lane.lead ?? null });
    if (lane.status !== "waiting")
      await mail.post(await roster.supervisorFor(project, lane.opener), seatLetters.halfOpen(lane));
  }
}
