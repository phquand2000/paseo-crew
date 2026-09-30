import { covers } from "../../core/scope.ts";
import { type Caller, type ToolReply, no, ok, str, strs } from "../context.ts";
import { type Amendment, amend } from "../../domain/amendment.ts";
import { type Lane, loseReady } from "../../domain/lane.ts";
import { laneOfLead } from "../../domain/ledger.ts";
import { askFirstOf } from "../human/questions.ts";
import { loadLedger } from "../store/ledger.ts";
import { besideNote, besideText } from "../letters/directive.ts";
import { workLetters } from "../letters/work-letters.ts";
import { serialIn } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { tellBeside } from "./lead-seat.ts";
import { type Beside, lanesBeside } from "./placement.ts";

/** A Lead widens its lane's write set; open lanes that may write the same are named and their Leads told, never a refusal. */
export async function takePaths(
  desk: Pick<DeskServices, "kit" | "ledgers" | "mail" | "roster">,
  caller: Caller,
  args: { paths: string[]; why: string },
): Promise<ToolReply> {
  const { project } = caller;
  const lane = laneOfLead(loadLedger(project.state), caller.id);
  if (!lane) return no("You have no open lane.");
  if (lane.writeSet.length === 0) return no(`Lane ${lane.id} declared no write set, so it already writes anywhere.`);
  const serial = await serialIn(desk.kit, project, project.root);
  const done = take(desk, caller, lane.id, strs(args.paths), { serial, why: str(args.why) });
  if (typeof done === "string") return no(done);
  recordEvent(project, { kind: "lane.amended", lane: lane.id, fields: ["writeSet"], by: caller.id, humanDropped: 0 });
  const supervisor = await desk.roster.supervisorFor(project, done.lane.opener);
  const note = besideNote(done.beside, "now works");
  if (supervisor) await desk.mail.post(supervisor, workLetters.taken(done.lane, done.amendment, note));
  await tellBeside(desk, project, done.lane, done.beside);
  const stops = await askFirstOf(project, done.lane);
  const beside =
    done.beside.length > 0
      ? ` It now works beside lanes that may write the same: ${besideText(done.beside)}; their Leads are told. What both write meets when the second merges or lands, and settling it in your lane is yours.`
      : "";
  return ok(
    `Lane ${lane.id} now writes ${done.lane.writeSet.join(", ")}; its owner is told, and a READY reported before no longer stands.${beside}${stops ? ` ${stops} It stops at its ready report for the Human.` : ""}`,
  );
}

/** Read where it is written: a lane opened meanwhile may write what this one now takes. */
function take(
  { ledgers }: Pick<DeskServices, "ledgers">,
  { project, id }: Caller,
  laneId: string,
  paths: string[],
  { serial, why }: { serial: string[]; why: string },
): { lane: Lane; amendment: Amendment; beside: Beside[] } | string {
  return ledgers.transact(project, (current) => {
    const entry = current.lanes[laneId];
    if (!entry || entry.status !== "open") return `Lane ${laneId} is not open.`;
    const added = paths.filter((path) => !covers(entry.writeSet, path));
    if (added.length === 0) return `Lane ${laneId} already writes ${paths.join(", ")}.`;
    const amendment = amend(entry, { writeSet: [...entry.writeSet, ...added] }, id, why)!;
    loseReady(entry);
    const others = Object.values(current.lanes).filter((other) => other.status === "open" && other.id !== laneId);
    const beside = lanesBeside(serial, others, entry.writeSet, entry.contracts);
    return { lane: { ...entry }, amendment, beside };
  });
}
