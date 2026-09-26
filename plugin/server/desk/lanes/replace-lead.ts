import { existsSync } from "node:fs";
import { namedOrNot, roleThatCan } from "../../catalog/kit.ts";
import { errorText } from "../../core/errors.ts";
import { plural } from "../../core/text.ts";
import { workKey } from "../claims.ts";
import { type Caller, type ToolReply, no, ok } from "../context.ts";
import { takeoverFor } from "../directive.ts";
import { holdRefusal } from "../hold.ts";
import { type Lane, findLane, loadLedger } from "../ledger.ts";
import { seatTitle } from "../names.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { leadSeatOf } from "./lead-seat.ts";

type Seated = { lead: string; role: string };

/** Seats a new Lead on an open lane whose Lead is gone, where the lane stands; a Lead Paseo already started is taken on. */
export async function replaceLead(
  desk: DeskServices,
  caller: Caller,
  asked: { lane: string; role: string },
): Promise<ToolReply> {
  const { ledgers, seating, roster } = desk;
  const { project } = caller;
  const lane = findLane(loadLedger(project.state), asked.lane);
  if (!lane) return no(`There is no lane ${asked.lane}.`);
  if (lane.status !== "open") return no(`Lane ${lane.id} is ${lane.status}; only an open lane has a Lead to replace.`);
  const held = holdRefusal(lane);
  if (held) return no(held);
  const seats = await roster.open();
  if (seats.some((seat) => seat.id === lane.lead))
    return no(`Lane ${lane.id}'s Lead ${lane.lead} is still seated; message it instead.`);
  const key = workKey(project, lane.id);
  const claimed = ledgers.transact(project, (ledger) => {
    const entry = ledger.lanes[lane.id];
    if (entry?.status !== "open" || entry.lead !== lane.lead || seating.has(key)) return false;
    seating.take(key);
    return true;
  });
  if (!claimed)
    return no(`Lane ${lane.id} changed while this was asked; read status and ask again if its Lead is still gone.`);
  try {
    const started = leadSeatOf(seats, project, lane.id);
    const seated = started
      ? { lead: started.id, role: started.labels?.["seatworks.role"] ?? "lead" }
      : await takeOver(desk, caller, lane, asked.role);
    if (typeof seated === "string") return no(seated);
    const moved = bind(desk, caller, lane, seated);
    recordEvent(project, {
      kind: "lead.replaced",
      lane: lane.id,
      was: lane.lead ?? null,
      lead: seated.lead,
      adopted: Boolean(started),
    });
    const how = started
      ? `the Lead ${seated.lead} that Paseo already had seated for it`
      : `a new Lead ${seated.lead}, told it takes over where the lane stands`;
    const asks =
      moved > 0 ? ` The ${moved} open ${plural(moved, "ask", "asks")} to the Lead that left now wait on it.` : "";
    return ok(`Lane ${lane.id} has ${how}.${asks}`);
  } finally {
    seating.release(key);
  }
}

/** Records the new Lead on its lane, and turns the open asks to the one that left over to it; how many moved. */
function bind({ ledgers }: Pick<DeskServices, "ledgers">, caller: Caller, lane: Lane, { lead, role }: Seated): number {
  return ledgers.transact(caller.project, (ledger) => {
    ledger.lanes[lane.id]!.lead = lead;
    ledger.agents[lead] = { id: lead, role, lane: lane.id };
    const asks = Object.values(ledger.asks).filter((ask) => ask.status === "open" && ask.to === lane.lead);
    for (const ask of asks) ask.to = lead;
    return asks.length;
  });
}

/** Starts a Lead in the lane's copy, told it takes over where the lane stands; or says why none can start. */
async function takeOver(
  { kit, agents }: Pick<DeskServices, "kit" | "agents">,
  caller: Caller,
  lane: Lane,
  asked: string,
): Promise<Seated | string> {
  const leadRole = roleThatCan(kit, "lead", asked || undefined);
  if (!leadRole) return namedOrNot(kit, "lead", asked, "lead a lane");
  if (!lane.worktree || !existsSync(lane.worktree))
    return `Lane ${lane.id} has no working copy left${lane.worktree ? ` at ${lane.worktree}` : ""}; close it and open the work again.`;
  try {
    const lead = await agents.start(
      caller.project,
      { path: lane.worktree, workspaceId: lane.workspaceId },
      leadRole.role,
      {
        parent: caller.id,
        title: seatTitle.of(lane, leadRole),
        prompt: await takeoverFor(kit, caller.project, lane, lane.worktree),
        labels: { "seatworks.lane": lane.id, "seatworks.role": leadRole.role },
      },
    );
    return { lead, role: leadRole.role };
  } catch (error) {
    return `The new Lead could not start: ${errorText(error)}`;
  }
}
