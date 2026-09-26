import { z } from "zod";
import { given, no, ok, str } from "../context.ts";
import { repeatsIncident } from "../incidents.ts";
import { amend, findLane, loadLedger } from "../ledger.ts";
import { letters } from "../letters.ts";
import { defineTool } from "../services.ts";
import { scopeProblem } from "../opening.ts";
import { serialIn } from "../project.ts";

/** Changes what a lane is asked while it is open or waiting, keeping what it was asked before; its Lead is told what moved. */
export const amendLane = defineTool({
  name: "amend_lane",
  input: z.strictObject({
    lane: z.string(),
    why: z.string(),
    outcome: z.string().optional(),
    acceptance: z.array(z.string()).optional(),
    outOfScope: z.array(z.string()).optional(),
    writeSet: z.array(z.string()).optional(),
    contracts: z.array(z.string()).optional(),
  }),
  async handle({ ctx }, caller, args) {
    const { project } = caller;
    const changes = given(args, ["outcome"], ["acceptance", "outOfScope", "writeSet", "contracts"]);
    if (changes.outcome === "" || changes.acceptance?.length === 0)
      return no("A lane keeps an outcome and at least one acceptance line; give what it is asked now.");
    const lane = findLane(loadLedger(project.state), str(args.lane));
    if (!lane) return no(`There is no lane ${str(args.lane)}.`);
    const refused = repeatsIncident(project.state, lane.lead, str(args.why), ...Object.values(changes).flat());
    if (refused) return no(refused);
    const scoped = Boolean(changes.writeSet || changes.contracts);
    const serial = scoped ? await serialIn(ctx.kit, project, project.root) : [];
    // Checked where it is written: a lane opened meanwhile may already hold the paths this one would take.
    const done = ctx.transact(project, (current) => {
      const entry = current.lanes[lane.id];
      if (!entry || entry.status === "closed")
        return `Lane ${lane.id} is closed; ask for the work again with open_lane.`;
      if (entry.status === "open" && scoped) {
        const others = Object.values(current.lanes).filter((other) => other.status === "open" && other.id !== lane.id);
        const problem = scopeProblem(
          serial,
          others,
          (changes.writeSet ?? entry.writeSet) as string[],
          (changes.contracts ?? entry.contracts) as string[],
        );
        if (problem)
          return `${problem.why} Leave those paths out of this lane, or ask for that work in a lane that waits for the other.`;
      }
      const amendment = amend(entry, changes, caller.id, str(args.why));
      if (!amendment) return `Nothing about lane ${lane.id} would change; pass the fields it is asked differently now.`;
      delete entry.ready;
      return { lane: { ...entry }, amendment };
    });
    if (typeof done === "string") return no(done);
    ctx.event(project, { kind: "lane.amended", lane: lane.id, fields: Object.keys(done.amendment.was), by: caller.id });
    if (done.lane.status === "waiting") return ok(`Lane ${lane.id} is amended; it opens as it is now.`);
    const posted = await ctx.post(done.lane.lead, letters.amended(done.lane, done.amendment, "lead"));
    return ok(
      `Lane ${lane.id} is amended${posted === "nobody" ? ", and it has no Lead to tell" : " and its Lead has the change"}; a READY it reported before no longer stands.`,
    );
  },
});
