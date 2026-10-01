import { z } from "zod";
import { closeLane } from "../lanes/closing.ts";
import { decideLand } from "../lanes/land-decision.ts";
import { humanWrote } from "../human/human-words.ts";
import { findLane } from "../../domain/ledger.ts";
import { clip } from "../../core/text.ts";
import { loadLedger } from "../store/ledger.ts";
import { no, str } from "../context.ts";
import { defineTool } from "../services.ts";

export const landLane = defineTool({
  name: "land_lane",
  input: z.strictObject({
    lane: z.string(),
    overGate: z.boolean().optional(),
    reason: z.string().optional(),
    approval: z.string().optional(),
  }),
  async handle(desk, caller, args) {
    // A red gate is evidence the Supervisor may overrule, never silently: landing over it says why.
    if (args.overGate && !str(args.reason))
      return no("Landing over a red gate needs its reason: pass reason with overGate true, or leave overGate out.");
    const approval = str(args.approval);
    const lane = findLane(loadLedger(caller.project.state), args.lane);
    const held = lane?.status === "open" ? lane.landApproval : undefined;
    if (!lane || !approval || !held || held.approved)
      return closeLane(desk, caller.project, caller.id, { ...args, land: true });
    if (!(await humanWrote(desk, caller.id, approval)))
      return no(
        `The Human's own words "${clip(approval, 200)}" are not in this chat as far back as the desk reads: quote their approval exactly, or leave the landing to them on the Flow tab.`,
      );
    return decideLand(desk, caller.project, lane.id, true, `in chat, "${clip(approval, 200)}"`);
  },
});
