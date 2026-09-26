import { currentBranch } from "../../core/git.ts";
import { plural } from "../../core/text.ts";
import { type Caller, type ToolReply, no, ok, str, strs } from "../context.ts";
import { laneGate } from "../project/gates.ts";
import { holdRefusal, putOnHold } from "./hold.ts";
import { askFirstHits, changeOf, changesStanding, landFacts, reviewFacts } from "./land-facts.ts";
import { type Lane, laneOfLead, loadLedger, tasksOf } from "../store/ledger.ts";
import { letters } from "../letters/letters.ts";
import type { Project } from "../project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { midTurnAmong } from "../seats/writing.ts";

/** A report call as the tool takes it. */
type ReportCall = { summary: string; ready: boolean; carried?: string[] };

type Gate = Awaited<ReturnType<typeof laneGate>>;

/** A Lead's report to whoever supervises, READY with the lane gated as it stands, or progress. */
export async function reportLane(desk: DeskServices, caller: Caller, args: ReportCall): Promise<ToolReply> {
  const { project } = caller;
  const lane = laneOfLead(loadLedger(project.state), caller.id);
  if (!lane) return no("You have no open lane.");
  const ready = args.ready === true;
  if (ready) {
    const blocked = await readyBlocked(desk, project, lane);
    if (blocked) return no(blocked);
  }
  const gate = ready ? await laneGate(desk, project, lane) : undefined;
  // Recorded on the lane the caller still leads: it may have closed, or had its Lead replaced, while the gate ran.
  const still = desk.ledgers.transact(project, (current) => {
    const entry = laneOfLead(current, caller.id);
    if (entry?.id !== lane.id) return false;
    if (ready) entry.ready = { at: Date.now() };
    else delete entry.ready;
    return true;
  });
  if (!still)
    return no(`Lane ${lane.id} is no longer yours to report on: it closed, or has another Lead, while this was asked.`);
  return tell(desk, project, lane, args, gate);
}

/** Why READY cannot be claimed now: the lane on hold, a seat still writing in its copy, or the copy on a task's branch. */
async function readyBlocked(desk: DeskServices, project: Project, lane: Lane): Promise<string | undefined> {
  const held = holdRefusal(lane);
  if (held) return held;
  // What ready claims is what the gate runs on: the merges accepted before it land first, and nobody writes under it.
  await desk.merges.retry(project);
  await desk.merges.settled(project);
  const inCopy = tasksOf(loadLedger(project.state), lane.id).filter(
    (task) => task.kind === "code" && task.mode !== "parallel",
  );
  const busy = await midTurnAmong(
    desk.roster,
    inCopy.map((task) => task.peer),
  );
  if (busy.length > 0) {
    const ends = plural(busy.length, "that turn ends", "those turns end");
    return `${busy.join(" and ")} ${plural(busy.length, "is", "are")} mid-turn in the lane's working copy, so what ready claims could still change under the gate. Report ready once ${ends}.`;
  }
  const on = await currentBranch(lane.worktree!);
  const holding = inCopy.find((task) => task.branch === on);
  if (holding)
    return `The lane's working copy is on ${on}, ${holding.id}'s branch, not ${lane.branch}: the gate would read ${holding.id}'s tree. Report ready once it is merged or cut.`;
  return undefined;
}

async function tell(
  desk: DeskServices,
  project: Project,
  lane: Lane,
  args: ReportCall,
  gate: Gate | undefined,
): Promise<ToolReply> {
  const ready = args.ready === true;
  const to = await desk.roster.supervisorFor(project, lane.opener);
  const parked = ready ? await parkAtCheckpoint(desk, project, lane.id) : undefined;
  const ahead = ready ? await readAhead(desk, project, lane) : { asks: [], facts: [], changes: false };
  const letter = letters.report(lane, str(args.summary), ready, strs(args.carried), { gate, parked, ...ahead });
  const posted = await desk.mail.post(to, letter);
  const text = posted === "nobody" ? letter.text : undefined;
  recordEvent(project, { kind: "lane.report", lane: lane.id, ready, gate: gate?.ok, to: to ?? null, text });
  // With nobody supervising seated the post goes nowhere; it is kept in the event log and the Lead told so.
  if (posted === "nobody")
    return ok(
      `Nobody supervising this project is seated, so the report reached no one. It is kept in ${project.state}/events.log for whoever comes back; there is nothing to wait for until someone does.`,
    );
  // Its reviews only: the rest may name an incident, which never reaches the seat it could be about.
  const reviews = ready ? reviewFacts(loadLedger(project.state), lane) : [];
  const also =
    reviews.length > 0 ? ` It also carries what the record has of the lane's reviews: ${reviews.join(" ")}` : "";
  return ok(
    `Reported to ${to}${gate && !gate.ok ? ", with what the gate did in it" : ""}.${also} Stay quiet until mail arrives.`,
  );
}

/** A lane that went on without the Human's answer to a costly question stops at its ready report; says which, when it did. */
async function parkAtCheckpoint(desk: DeskServices, project: Project, lane: string): Promise<string | undefined> {
  const waiting = desk.ledgers.transact(project, (ledger) => {
    const open = Object.values(ledger.questions).filter(
      (question) => question.lane === lane && question.status === "open" && question.class === "costly",
    );
    for (const question of open) question.parked = true;
    return open.map((question) => question.id);
  });
  if (waiting.length === 0) return undefined;
  const reason = `it went on without the Human's answer to ${waiting.join(", ")}, and stops at its ready report until they answer`;
  const held = await putOnHold(desk, project, lane, "desk", reason);
  return typeof held === "string" ? undefined : `It is on hold: ${reason}.`;
}

/** What landing a lane reported ready would bring and wait for, read before whoever lands it decides to. */
async function readAhead(
  { kit }: Pick<DeskServices, "kit">,
  project: Project,
  lane: Lane,
): Promise<{ asks: string[]; facts: string[]; changes: boolean }> {
  const change = await changeOf(project, lane);
  const ledger = loadLedger(project.state);
  const facts = await landFacts(kit, project, ledger, lane, change);
  return { asks: askFirstHits(project, change), facts, changes: changesStanding(ledger, lane) };
}
