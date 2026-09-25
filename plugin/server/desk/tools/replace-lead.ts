import { existsSync } from "node:fs";
import { z } from "zod";
import { namedOrNot, roleThatCan } from "../../catalog/kit.ts";
import { errorText } from "../../core/errors.ts";
import { type Caller, no, ok, str } from "../context.ts";
import { type Lane, findLane, loadLedger } from "../ledger.ts";
import { seatTitle } from "../names.ts";
import { type DeskServices, defineTool } from "../services.ts";
import { takeoverFor } from "../directive.ts";
import { leadSeatOf, seatingKey } from "../opening.ts";

/** Starts a Lead in the lane's copy, told it takes over where the lane stands; or says why none can start. */
async function takeOver({ ctx, agents }: DeskServices, caller: Caller, lane: Lane, asked: string): Promise<{ lead: string; role: string } | string> {
  const leadRole = roleThatCan(ctx.kit, "lead", asked || undefined);
  if (!leadRole) return namedOrNot(ctx.kit, "lead", asked, "lead a lane");
  if (!lane.worktree || !existsSync(lane.worktree)) return `Lane ${lane.id} has no working copy left${lane.worktree ? ` at ${lane.worktree}` : ""}; close it and open the work again.`;
  try {
    const lead = await agents.start(caller.project, { path: lane.worktree, workspaceId: lane.workspaceId }, leadRole.role, {
      parent: caller.id,
      title: seatTitle.of(lane, leadRole),
      prompt: await takeoverFor(ctx.kit, caller.project, lane, lane.worktree),
      labels: { "seatworks.lane": lane.id, "seatworks.role": leadRole.role },
    });
    return { lead, role: leadRole.role };
  } catch (error) {
    return `The new Lead could not start: ${errorText(error)}`;
  }
}

/** Seats a new Lead on an open lane whose Lead is gone, where the lane stands; a Lead Paseo already started for it is taken on instead. */
export const replaceLead = defineTool({
  name: "replace_lead",
  input: z.strictObject({ lane: z.string(), role: z.string().optional() }),
  async handle(desk, caller, args) {
    const { ctx, roster } = desk;
    const { project } = caller;
    const lane = findLane(loadLedger(project.state), str(args.lane));
    if (!lane) return no(`There is no lane ${str(args.lane)}.`);
    if (lane.status !== "open") return no(`Lane ${lane.id} is ${lane.status}; only an open lane has a Lead to replace.`);
    const seats = await roster.open();
    if (seats.some((seat) => seat.id === lane.lead)) return no(`Lane ${lane.id}'s Lead ${lane.lead} is still seated; message it instead.`);
    const key = seatingKey(project, lane.id);
    const claimed = ctx.transact(project, (ledger) => {
      const entry = ledger.lanes[lane.id];
      if (entry?.status !== "open" || entry.lead !== lane.lead || ctx.seating.has(key)) return false;
      ctx.seating.add(key);
      return true;
    });
    if (!claimed) return no(`Lane ${lane.id} changed while this was asked; read status and ask again if its Lead is still gone.`);
    try {
      const started = leadSeatOf(seats, project, lane.id);
      const seated = started ? { lead: started.id, role: started.labels?.["seatworks.role"] ?? "lead" } : await takeOver(desk, caller, lane, str(args.role));
      if (typeof seated === "string") return no(seated);
      const { lead, role } = seated;
      const moved = ctx.transact(project, (ledger) => {
        ledger.lanes[lane.id]!.lead = lead;
        ledger.agents[lead] = { id: lead, role, lane: lane.id };
        const asks = Object.values(ledger.asks).filter((ask) => ask.status === "open" && ask.to === lane.lead);
        for (const ask of asks) ask.to = lead;
        return asks.length;
      });
      ctx.event(project, { kind: "lead.replaced", lane: lane.id, was: lane.lead ?? null, lead, adopted: Boolean(started) });
      const how = started ? `the Lead ${lead} that Paseo already had seated for it` : `a new Lead ${lead}, told it takes over where the lane stands`;
      const asks = moved > 0 ? ` The ${moved} open ask${moved === 1 ? "" : "s"} to the Lead that left now wait on it.` : "";
      return ok(`Lane ${lane.id} has ${how}.${asks}`);
    } finally {
      ctx.seating.delete(key);
    }
  },
});
