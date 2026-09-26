import { z } from "zod";
import { no, ok, str } from "../context.ts";
import { findLane, laneSeats } from "../ledger.ts";
import { letters } from "../letters.ts";
import { defineTool } from "../services.ts";
import { openWaiting, startWaiting } from "../waiting.ts";

/** Lifts a hold: each seat of the lane is told to carry on, with the mail held for it, and what waited on the lane may start. */
export const resumeLane = defineTool({
  name: "resume_lane",
  input: z.strictObject({ lane: z.string(), note: z.string().optional() }),
  async handle(desk, caller, args) {
    const { ctx } = desk;
    const { project } = caller;
    const lifted = ctx.transact(project, (ledger) => {
      const lane = findLane(ledger, args.lane);
      if (!lane?.onHold) return `Lane ${lane?.id ?? str(args.lane)} is not on hold.`;
      delete lane.onHold;
      return { lane: { ...lane }, seats: laneSeats(ledger, lane) };
    });
    if (typeof lifted === "string") return no(lifted);
    for (const { seat, task } of lifted.seats) await ctx.post(seat, letters.resumed(lifted.lane, str(args.note), task));
    ctx.event(project, { kind: "lane.resumed", lane: lifted.lane.id, by: caller.id });
    await openWaiting(desk, project, true);
    await startWaiting(desk, project, true);
    await desk.merges.retry(project);
    return ok(`Lane ${lifted.lane.id} resumes: each of its seats is told to carry on, with what was held for it.`);
  },
});
