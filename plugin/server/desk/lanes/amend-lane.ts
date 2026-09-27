import { type Args, type Caller, type ToolReply, given, no, ok, str } from "../context.ts";
import { repeatsIncident } from "../store/incidents.ts";
import { type Amendment, amend } from "../../domain/amendment.ts";
import type { Lane } from "../../domain/lane.ts";
import { findLane } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { workLetters } from "../letters/work-letters.ts";
import { serialIn } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { openWaiting } from "../waiting/lanes.ts";
import { afterIds, laneAfterProblem } from "../waiting/rules.ts";
import { scopeProblem } from "./placement.ts";

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
  return ok(
    `Lane ${lane.id} is amended${posted === "nobody" ? ", and it has no Lead to tell" : " and its Lead has the change"}; a READY it reported before no longer stands.`,
  );
}

/** Checked where it is written: a lane opened meanwhile may already hold the paths this one would take. */
function record(
  { ledgers }: Pick<DeskServices, "ledgers">,
  { project, id }: Caller,
  laneId: string,
  changes: Changes,
  { serial, why }: { serial: string[]; why: string },
): { lane: Lane; amendment: Amendment } | string {
  return ledgers.transact(project, (current) => {
    const entry = current.lanes[laneId];
    if (!entry || entry.status === "closed") return `Lane ${laneId} is closed; ask for the work again with open_lane.`;
    const reordered = changes.after ? laneAfterProblem(current, entry, changes.after as string[]) : undefined;
    if (reordered) return reordered;
    if (entry.status === "open" && (changes.writeSet || changes.contracts)) {
      const others = Object.values(current.lanes).filter((other) => other.status === "open" && other.id !== laneId);
      const problem = scopeProblem(
        serial,
        others,
        (changes.writeSet ?? entry.writeSet) as string[],
        (changes.contracts ?? entry.contracts) as string[],
      );
      if (problem)
        return `${problem.why} Leave those paths out of this lane, or ask for that work in a lane that waits for the other.`;
    }
    const amendment = amend(entry, changes, id, why);
    if (!amendment) return `Nothing about lane ${laneId} would change; pass the fields it is asked differently now.`;
    delete entry.ready;
    if (amendment.was.after) delete entry.held;
    return { lane: { ...entry }, amendment };
  });
}
