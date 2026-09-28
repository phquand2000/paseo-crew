import { covers } from "../../core/scope.ts";
import { type Caller, type ToolReply, no, ok, str, strs } from "../context.ts";
import { type Amendment, amend } from "../../domain/amendment.ts";
import type { Lane } from "../../domain/lane.ts";
import { laneOfLead } from "../../domain/ledger.ts";
import { askFirstOf } from "../human/questions.ts";
import { loadLedger } from "../store/ledger.ts";
import { workLetters } from "../letters/work-letters.ts";
import { serialIn } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { scopeProblem } from "./placement.ts";

/** A Lead widens its lane's write set by paths no other open lane holds; one held elsewhere stays the Supervisor's call. */
export async function takePaths(
  desk: Pick<DeskServices, "kit" | "ledgers" | "mail" | "roster">,
  caller: Caller,
  args: { paths: string[]; why: string },
): Promise<ToolReply> {
  const { project } = caller;
  const lane = laneOfLead(loadLedger(project.state), caller.id);
  if (!lane) return no("You have no open lane.");
  if (lane.writeSet.length === 0)
    return no(`Lane ${lane.id} declared no write set, so it already writes anywhere another lane does not hold.`);
  const serial = await serialIn(desk.kit, project, project.root);
  const done = take(desk, caller, lane.id, strs(args.paths), { serial, why: str(args.why) });
  if (typeof done === "string") return no(done);
  recordEvent(project, { kind: "lane.amended", lane: lane.id, fields: ["writeSet"], by: caller.id });
  const supervisor = await desk.roster.supervisorFor(project, done.lane.opener);
  if (supervisor) await desk.mail.post(supervisor, workLetters.taken(done.lane, done.amendment));
  const stops = await askFirstOf(project, done.lane);
  return ok(
    `Lane ${lane.id} now writes ${done.lane.writeSet.join(", ")}; its owner is told, and a READY reported before no longer stands.${stops ? ` ${stops} It stops at its ready report for the Human.` : ""}`,
  );
}

/** Checked where it is written: a lane opened meanwhile may already hold what this one would take. */
function take(
  { ledgers }: Pick<DeskServices, "ledgers">,
  { project, id }: Caller,
  laneId: string,
  paths: string[],
  { serial, why }: { serial: string[]; why: string },
): { lane: Lane; amendment: Amendment } | string {
  return ledgers.transact(project, (current) => {
    const entry = current.lanes[laneId];
    if (!entry || entry.status !== "open") return `Lane ${laneId} is not open.`;
    const added = paths.filter((path) => !covers(entry.writeSet, path));
    if (added.length === 0) return `Lane ${laneId} already writes ${paths.join(", ")}.`;
    const writeSet = [...entry.writeSet, ...added];
    const others = Object.values(current.lanes).filter((other) => other.status === "open" && other.id !== laneId);
    const problem = scopeProblem(serial, others, writeSet, entry.contracts);
    if (problem) return `${problem.why} Ask with kind need: which lane writes it is your owner's call.`;
    const amendment = amend(entry, { writeSet }, id, why)!;
    delete entry.ready;
    return { lane: { ...entry }, amendment };
  });
}
