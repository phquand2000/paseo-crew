import { type Args, type Caller, type ToolReply, given, no, ok, str } from "../context.ts";
import { repeatsIncident } from "../store/incidents.ts";
import { type Amendment, amend } from "../../domain/amendment.ts";
import { type Lane, loseReady } from "../../domain/lane.ts";
import { findLane } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { workLetters } from "../letters/work-letters.ts";
import { serialIn } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { besideNote } from "../letters/directive.ts";
import { recordEvent } from "../store/event-log.ts";
import { openWaiting } from "../waiting/lanes.ts";
import { afterIds, laneAfterProblem } from "../waiting/rules.ts";
import { tellBeside } from "./lead-seat.ts";
import { type Beside, lanesBeside } from "./placement.ts";

type Changes = Record<string, string | string[]>;

/** Changes what a lane is asked while it is open or waiting, keeping what it was asked before; its Lead is told what moved. */
export async function amendLane(desk: DeskServices, caller: Caller, args: Args): Promise<ToolReply> {
  const { project } = caller;
  const changes = given(args, ["outcome"], ["acceptance", "outOfScope", "writeSet", "contracts", "after"]);
  if (changes.after) changes.after = afterIds(changes.after as string[]);
  if (changes.outcome === "" || changes.acceptance?.length === 0)
    return no("A lane keeps an outcome and at least one acceptance line; give what it is asked now.");
  const lane = findLane(loadLedger(project.state), str(args.lane));
  if (!lane) return no(`There is no lane ${str(args.lane)}.`);
  const refused = repeatsIncident(project.state, lane.lead, str(args.why), ...Object.values(changes).flat());
  if (refused) return no(refused);
  const scoped = Boolean(changes.writeSet || changes.contracts);
  const serial = scoped ? await serialIn(desk.kit, project, project.root) : [];
  const done = record(desk, caller, lane.id, changes, { serial, why: str(args.why) });
  if (typeof done === "string") return no(done);
  recordEvent(project, {
    kind: "lane.amended",
    lane: lane.id,
    fields: Object.keys(done.amendment.was),
    by: caller.id,
  });
  if (done.lane.status === "waiting") {
    // What it waits for changed: it may open now, or be held for a new reason.
    if (done.amendment.was.after) await openWaiting(desk, project, true);
    return ok(`Lane ${lane.id} is amended; it opens as it is now.`);
  }
  const posted = await desk.mail.post(done.lane.lead, workLetters.amended(done.lane, done.amendment, "lead"));
  await tellBeside(desk, project, done.lane, done.beside);
  // Its own Lead hears of each lane beside it as that lane's Lead hears of it.
  const lanes = loadLedger(project.state).lanes;
  for (const { lane: id, paths } of done.beside) {
    const other = lanes[id];
    if (other) await desk.mail.post(done.lane.lead, workLetters.laneBeside(other, paths));
  }
  return ok(
    `Lane ${lane.id} is amended${posted === "nobody" ? ", and it has no Lead to tell" : " and its Lead has the change"}; a READY it reported before no longer stands.${besideNote(done.beside, "now works")}`,
  );
}

/** Read where it is written: a lane opened meanwhile may write what this one now does. */
function record(
  { ledgers }: Pick<DeskServices, "ledgers">,
  { project, id }: Caller,
  laneId: string,
  changes: Changes,
  { serial, why }: { serial: string[]; why: string },
): { lane: Lane; amendment: Amendment; beside: Beside[] } | string {
  return ledgers.transact(project, (current) => {
    const entry = current.lanes[laneId];
    if (!entry || entry.status === "closed") return `Lane ${laneId} is closed; ask for the work again with open_lane.`;
    const reordered = changes.after ? laneAfterProblem(current, entry, changes.after as string[]) : undefined;
    if (reordered) return reordered;
    const amendment = amend(entry, changes, id, why);
    if (!amendment) return `Nothing about lane ${laneId} would change; pass the fields it is asked differently now.`;
    loseReady(entry);
    if (amendment.was.after) delete entry.held;
    const others = Object.values(current.lanes).filter((other) => other.status === "open" && other.id !== laneId);
    const scoped = Boolean(changes.writeSet || changes.contracts);
    const beside =
      entry.status === "open" && scoped ? lanesBeside(serial, others, entry.writeSet, entry.contracts) : [];
    return { lane: { ...entry }, amendment, beside };
  });
}
