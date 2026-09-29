import { mergeBranch } from "../../core/git-merge.ts";
import { currentBranch, headSha, isAncestor, landedRef } from "../../core/git.ts";
import { landLane as landOnBase } from "../../core/land.ts";
import { no, ok } from "../context.ts";
import { laneGate } from "../project/gates.ts";
import { type Lane, loseReady } from "../../domain/lane.ts";
import { type Ledger, tasksOf } from "../../domain/ledger.ts";
import { landLetters } from "../letters/land-letters.ts";
import { type Project, loadConfig } from "../project/project.ts";
import type { Roster } from "../seats/roster.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { midTurnAmong } from "../seats/writing.ts";
import { unsavedIn } from "../copies/unsaved.ts";
import { type Closed, type Held, type OverGate, checkLanding, waitsForHuman } from "./land-hold.ts";

/** How a lane landed, as its CLOSED reply and letters say; `note` is the evidence that went with it. */
export type Landed = { how: string; note: string };

/** What stops the base merge a landing starts with; `writers` are the seats mid-turn in the lane's copy. */
type Stop = { why: string; then: string; writers?: string[] };

const SETTLE = "land_lane it again once the Lead reports it ready, or drop_lane it.";

/** Lands an open lane for `by`, or says what kept it: the Human's hold, base that will not merge, a red gate. */
export async function landLane(
  desk: DeskServices,
  project: Project,
  ledger: Ledger,
  lane: Lane,
  by: string,
  over: OverGate,
): Promise<Closed | Landed> {
  const tip = await headSha(project.root, lane.branch);
  // A commit after the hold makes it a lane nobody has looked at: it is checked again from the start.
  const approved = lane.landApproval?.approved && lane.landApproval.head === tip ? lane.landApproval : undefined;
  const waits = await waitsForHuman(desk, project, lane, tip, approved);
  if (waits) return waits;
  const unsaved = lane.worktree ? await unsavedIn(lane.worktree, Boolean(lane.slot)) : undefined;
  if (unsaved) {
    const why = `its working copy ${unsaved}`;
    const text = `Lane ${lane.id} was not closed: ${why}. Only what is committed lands, so overGate does not pass it: have its Lead get it committed or cleared, then land_lane it again; or drop_lane it, which keeps the copy and that work.`;
    return { ...no(text), blocked: why };
  }
  // Land before closing: a closed lane cannot be closed again, so a landing that cannot happen is refused while open.
  const stop = await bringBaseIn(desk, project, ledger, lane);
  if (stop) {
    const { writers } = stop;
    if (writers)
      desk.ledgers.setLane(project, lane.id, (entry) => {
        entry.landing = { by, writers };
      });
    return { ...no(`Lane ${lane.id} was not closed: ${stop.why}. ${stop.then}`), blocked: stop.why };
  }
  // Base merged in by the desk itself is not the lane changing under an approval.
  const merged = approved ? await headSha(project.root, lane.branch) : tip;
  if (approved && merged && merged !== tip) {
    desk.ledgers.setLane(project, lane.id, (entry) => {
      if (entry.landApproval) entry.landApproval.head = merged;
    });
  }
  return gateThenLand(desk, project, ledger, lane, by, over, approved);
}

/** The gate on the head that lands, the Human's hold where they asked for one, then the landing itself. */
async function gateThenLand(
  desk: DeskServices,
  project: Project,
  ledger: Ledger,
  lane: Lane,
  by: string,
  over: OverGate,
  approved: Held | undefined,
): Promise<Closed | Landed> {
  // What lands is the head its gate saw: a lane that moves after the gate lands nothing.
  const tested = await headSha(project.root, lane.branch);
  if (!tested) {
    const why = `git could not read ${lane.branch}`;
    return {
      ...no(
        `Lane ${lane.id} was not closed: ${why}, so what its gate would see is not known. land_lane it again, or drop_lane it.`,
      ),
      blocked: why,
    };
  }
  const gate = await laneGate(desk, project, lane);
  // A red gate stops landing unless the Supervisor passes `overGate`: the verdict is evidence, not a veto. One that never ran is no verdict.
  if (!gate.ok && (!gate.ran || !over.overGate)) {
    const then = gate.ran
      ? "Message its Lead, drop_lane it, or land_lane it over the gate with overGate true and your reason: that is your call."
      : "land_lane it again once it can run, or drop_lane it.";
    const text = `Lane ${lane.id} was not closed: ${gate.text}\n${then}`;
    return { ...no(text), blocked: gate.text.split("\n")[0]!.replace(/\.$/, "") };
  }
  const check = await checkLanding(desk, project, lane, gate, over, approved);
  if (check.held) return ok(check.held);
  const how = { as: loadConfig(project.state).landAs, message: landMessage(ledger, lane), keep: landedRef(lane.id) };
  const result = lane.onBranch
    ? { landed: true, how: `the work stays on ${lane.branch}, the branch it carried on; nothing was merged anywhere` }
    : await landOnBase(project.root, lane.base, lane.branch, tested, how);
  if (!result.landed) {
    const text = `Lane ${lane.id} was not closed: it could not land, because ${result.how}. land_lane it again once that is cleared, or drop_lane it.`;
    return { ...no(text), blocked: result.how };
  }
  if (!gate.ok) recordEvent(project, { kind: "gate.overridden", lane: lane.id, by });
  return { how: `${result.how}${gate.ok ? "" : ", over a red gate"}`, note: check.note };
}

/** Merges base into the lane in its own copy, never under a seat mid-turn there; on conflicts a task takes base in on its own branch. */
async function bringBaseIn(
  { ledgers, mail, roster }: Pick<DeskServices, "ledgers" | "mail" | "roster">,
  project: Project,
  ledger: Ledger,
  lane: Lane,
): Promise<Stop | undefined> {
  const copy = lane.worktree;
  if (!copy)
    return { why: `it has no working copy on record to merge ${lane.base} into`, then: "Drop it with drop_lane." };
  const blocked = await baseMergeBlocked(roster, ledger, lane, copy);
  if (blocked) return blocked === "current" ? undefined : blocked;
  // Never left mid-merge: every task in the copy starts by switching branch, which git refuses then.
  const merged = await mergeBranch(copy, lane.base, `Bring ${lane.base} into ${lane.branch}`);
  if (merged.ok) return undefined;
  if (merged.conflicts.length === 0)
    return {
      why: `${lane.base} has moved on and does not merge into ${lane.branch}: ${merged.message}`,
      then: "Nothing was changed. Message its Lead, or drop_lane it.",
    };
  // What it was reported ready as is not what it holds now.
  ledgers.setLane(project, lane.id, loseReady);
  await mail.post(lane.lead, landLetters.baseConflict(lane, merged.conflicts));
  return {
    why: `${lane.base} has moved on and conflicts with ${lane.branch} in ${merged.conflicts.join(", ")}`,
    then: `Nothing was left in the lane's copy, and its Lead has a letter to have a task take ${lane.base} in; ${SETTLE}`,
  };
}

/** Why base cannot be merged into the lane's copy now, or "current" when it holds base already; an unseen seat counts as writing. */
async function baseMergeBlocked(
  roster: Roster,
  ledger: Ledger,
  lane: Lane,
  copy: string,
): Promise<Stop | "current" | undefined> {
  // A task's branch there is work the lane has not taken: neither base nor the gate would meet the lane's own tree.
  const on = await currentBranch(copy);
  const holding = tasksOf(ledger, lane.id).find((task) => task.kind === "code" && task.branch === on);
  if (holding)
    return {
      why: `its working copy is on ${on}, ${holding.id}'s branch, not ${lane.branch}`,
      then: `Land it once ${holding.id} is merged or cut.`,
    };
  if (await isAncestor(copy, lane.base, lane.branch)) return "current";
  // Readers count too: a merge changes the files under whoever is reading them.
  const inCopy = tasksOf(ledger, lane.id).filter((task) => task.mode !== "parallel");
  const busy = await midTurnAmong(roster, [lane.lead, ...inCopy.map((task) => task.peer)]);
  if (busy.length === 0) return undefined;
  return {
    why: `${lane.base} has moved on, so landing it starts with merging ${lane.base} into ${lane.branch} in its copy, and a seat is mid-turn there`,
    then: "CAN LAND comes as mail when that turn ends; land_lane it again then, or drop_lane it.",
    writers: busy,
  };
}

/** What a lane lands under as one commit or a merge: its title, its outcome and the tasks that went into it. */
function landMessage(ledger: Ledger, lane: Lane): string {
  const tasks = tasksOf(ledger, lane.id).filter((task) => task.kind === "code" && task.status === "merged");
  const list = tasks.length > 0 ? ["", ...tasks.map((task) => `- ${task.id} ${task.title}`)] : [];
  return [`${lane.title} (${lane.id})`, "", lane.outcome, ...list].join("\n");
}
