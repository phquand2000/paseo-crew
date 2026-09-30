import { type Args, type Caller, type ToolReply, given, no, ok, str } from "../context.ts";
import { repeatsIncident } from "../store/incidents.ts";
import { type Amendment, amend } from "../../domain/amendment.ts";
import { type HumanClaim, type HumanLine, type Lane, carryHuman, loseReady } from "../../domain/lane.ts";
import { findLane } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { workLetters } from "../letters/work-letters.ts";
import { serialIn } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { besideNote } from "../letters/directive.ts";
import { recordEvent } from "../store/event-log.ts";
import { openWaiting } from "../waiting/lanes.ts";
import { afterIds, laneAfterProblem } from "../waiting/rules.ts";
import { type Claimed, humanClaims, strayLine } from "./human-lines.ts";
import { tellBeside } from "./lead-seat.ts";
import { type Beside, lanesBeside } from "./placement.ts";

type Changes = Record<string, string | string[]>;

type Amended = { lane: Lane; amendment: Amendment; beside: Beside[]; claims: HumanClaim[]; dropped: HumanLine[] };

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
  const claims = await humanClaims(desk, caller, args.human as Claimed[] | undefined);
  if (typeof claims === "string") return no(claims);
  const scoped = Boolean(changes.writeSet || changes.contracts);
  const serial = scoped ? await serialIn(desk.kit, project, project.root) : [];
  const done = record(desk, caller, lane.id, changes, { serial, why: str(args.why), claims });
  if (typeof done === "string") return no(done);
  recordEvent(project, {
    kind: "lane.amended",
    lane: lane.id,
    fields: Object.keys(done.amendment.was),
    by: caller.id,
    humanDropped: done.dropped.length,
  });
  const dropped = droppedNote(done.dropped);
  if (done.lane.status === "waiting") {
    // What it waits for changed: it may open now, or be held for a new reason.
    if (done.amendment.was.after) await openWaiting(desk, project, true);
    return ok(`Lane ${lane.id} is amended; it opens as it is now.${dropped}`);
  }
  return ok(`${await tellLead(desk, caller, done)}${dropped}`);
}

/** Tells the lane's Lead what moved, and each Lead beside it; the reply says what the Lead was told. */
async function tellLead(desk: DeskServices, { project }: Caller, done: Amended): Promise<string> {
  const letter = workLetters.amended(done.lane, done.amendment, "lead", done);
  const posted = await desk.mail.post(done.lane.lead, letter);
  await tellBeside(desk, project, done.lane, done.beside);
  // Its own Lead hears of each lane beside it as that lane's Lead hears of it.
  const lanes = loadLedger(project.state).lanes;
  for (const { lane: id, paths } of done.beside) {
    const other = lanes[id];
    if (other) await desk.mail.post(done.lane.lead, workLetters.laneBeside(other, paths));
  }
  const told = posted === "nobody" ? ", and it has no Lead to tell" : " and its Lead has the change";
  const ready = Object.keys(done.amendment.was).length > 0 ? "; a READY it reported before no longer stands" : "";
  return `Lane ${done.lane.id} is amended${told}${ready}.${besideNote(done.beside, "now works")}`;
}

const droppedNote = (dropped: HumanLine[]): string =>
  dropped.length > 0
    ? ` It changes what the Human asked for without their word: ${dropped.map((entry) => `"${entry.line}"`).join(", ")}. Tell them, or put it to them with ask_human.`
    : "";

/** Read where it is written: a lane opened meanwhile may write what this one now does. */
function record(
  { ledgers }: Pick<DeskServices, "ledgers">,
  { project, id }: Caller,
  laneId: string,
  changes: Changes,
  { serial, why, claims }: { serial: string[]; why: string; claims: HumanClaim[] },
): Amended | string {
  return ledgers.transact(project, (current) => {
    const entry = current.lanes[laneId];
    if (!entry || entry.status === "closed") return `Lane ${laneId} is closed; ask for the work again with open_lane.`;
    const reordered = changes.after ? laneAfterProblem(current, entry, changes.after as string[]) : undefined;
    if (reordered) return reordered;
    const next = { ...entry, ...(changes as Partial<Lane>) };
    const dropped = carryHuman(next, claims, id);
    if (!Array.isArray(dropped)) return strayLine(dropped);
    const amendment = amend(entry, changes, id, why) ?? (claims.length > 0 ? marked(entry, id, why) : undefined);
    if (!amendment) return `Nothing about lane ${laneId} would change; pass the fields it is asked differently now.`;
    if (next.human) entry.human = next.human;
    else delete entry.human;
    if (Object.keys(amendment.was).length > 0) loseReady(entry);
    if (amendment.was.after) delete entry.held;
    const others = Object.values(current.lanes).filter((other) => other.status === "open" && other.id !== laneId);
    const scoped = Boolean(changes.writeSet || changes.contracts);
    const beside =
      entry.status === "open" && scoped ? lanesBeside(serial, others, entry.writeSet, entry.contracts) : [];
    return { lane: { ...entry }, amendment, beside, claims, dropped };
  });
}

/** An amendment that changes nothing the lane is asked, only whose word stands behind its lines: READY stands. */
function marked(entry: Lane, by: string, why: string): Amendment {
  const amendment = { at: Date.now(), by, why, was: {} };
  entry.amended = [...(entry.amended ?? []), amendment];
  return amendment;
}
