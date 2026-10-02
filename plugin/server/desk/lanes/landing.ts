import { headSha, landedRef } from "../../core/git.ts";
import { landLane as landOnBase } from "../../core/land.ts";
import { no, ok } from "../context.ts";
import { laneGate } from "../project/gates.ts";
import { type Lane, loseReady } from "../../domain/lane.ts";
import { type Ledger, tasksOf } from "../../domain/ledger.ts";
import { landLetters } from "../letters/land-letters.ts";
import { type Project, loadConfig } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { unsavedIn } from "../copies/unsaved.ts";
import { bringBaseIn } from "./base-in.ts";
import { type Closed, type Held, type OverGate, checkLanding, waitsForHuman } from "./land-hold.ts";

/** How a lane landed, as its CLOSED reply and letters say; `note` is the evidence that went with it. */
export type Landed = { how: string; note: string };

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
  const waits = await waitsForHuman(desk, project, lane, tip);
  if (waits) return waits;
  const unsaved = lane.worktree ? await unsavedIn(lane.worktree, Boolean(lane.slot)) : undefined;
  if (unsaved) {
    const why = `its working copy ${unsaved}`;
    const text = `Lane ${lane.id} was not closed: ${why}. Only what is committed lands, so overGate does not pass it: have its Lead get it committed or cleared, then land_lane it again; or drop_lane it, which keeps the copy and that work.`;
    return { ...no(text), blocked: why };
  }
  // Land before closing: a closed lane cannot be closed again, so a landing that cannot happen is refused while open.
  const stop = await bringBaseIn(desk.roster, project, ledger, lane);
  if (stop?.conflicts) {
    // What it was reported ready as is not what it holds now.
    desk.ledgers.setLane(project, lane.id, loseReady);
    await desk.mail.post(lane.lead, landLetters.baseConflict(lane, stop.conflicts));
    const then = `Nothing was left in the lane's copy, and its Lead has a letter to have a task take ${lane.base} in; ${SETTLE}`;
    return { ...no(`Lane ${lane.id} was not closed: ${stop.why}. ${then}`), blocked: stop.why };
  }
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

/** What a lane lands under as one commit or a merge: its title, its outcome and the tasks that went into it. */
function landMessage(ledger: Ledger, lane: Lane): string {
  const tasks = tasksOf(ledger, lane.id).filter((task) => task.kind === "code" && task.status === "merged");
  const list = tasks.length > 0 ? ["", ...tasks.map((task) => `- ${task.id} ${task.title}`)] : [];
  return [`${lane.title} (${lane.id})`, "", lane.outcome, ...list].join("\n");
}
