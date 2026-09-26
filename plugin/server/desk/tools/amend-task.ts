import { z } from "zod";
import { DECIDED } from "../../domain/task.ts";
import { given, no, ok, str } from "../context.ts";
import { repeatsIncident } from "../incidents.ts";
import { amend, loadLedger } from "../ledger.ts";
import { letters } from "../letters.ts";
import { tellMoment } from "../moments.ts";
import { parallelProblem, serialIn } from "../opening.ts";
import { defineTool } from "../services.ts";
import { laneTask } from "./lane-task.ts";

/** Changes what a task asks while its Peer works, keeping what it asked before; the Peer is told at its next turn, not cut off. */
export const amendTask = defineTool({
  name: "amend_task",
  input: z.strictObject({ task: z.string(), why: z.string(), goal: z.string().optional(), acceptance: z.array(z.string()).optional(), outOfScope: z.array(z.string()).optional(), owned: z.array(z.string()).optional() }),
  async handle(desk, caller, args) {
    const { ctx } = desk;
    const changes = given(args, ["goal"], ["acceptance", "outOfScope", "owned"]);
    if (changes.goal === "" || changes.acceptance?.length === 0) return no("A task keeps a goal and at least one acceptance line; give what it asks now.");
    if (changes.owned?.length === 0) return no("A task keeps at least one owned path; give every path it owns now.");
    const asked = laneTask(loadLedger(caller.project.state), caller, str(args.task));
    const refused = typeof asked === "string" ? undefined : repeatsIncident(caller.project.state, asked.task.peer, str(args.why), ...Object.values(changes).flat());
    if (refused) return no(refused);
    const beside = typeof asked !== "string" && changes.owned !== undefined && asked.task.mode === "parallel";
    const serial = beside ? await serialIn(ctx.kit, caller.project, asked.lane.worktree ?? caller.project.root) : [];
    const done = ctx.transact(caller.project, (ledger) => {
      const found = laneTask(ledger, caller, str(args.task));
      if (typeof found === "string") return found;
      const { lane, task } = found;
      if (DECIDED.includes(task.status)) return `${task.id} is ${task.status}; start a task for what is asked now.`;
      // Checked as a start is, where it is written: a task beside others that takes more paths could take what another writes. A waiting one is checked when it starts.
      const problem = beside && task.status !== "waiting" ? parallelProblem(ledger, lane, changes.owned as string[], serial, task.id) : undefined;
      if (problem) return `${problem.why} Leave those paths out of ${task.id}.`;
      const amendment = amend(task, changes, caller.id, str(args.why));
      if (!amendment) return `Nothing about ${task.id} would change; pass the fields it asks differently now.`;
      task.updatedAt = Date.now();
      return { task: { ...task }, amendment };
    });
    if (typeof done === "string") return no(done);
    ctx.event(caller.project, { kind: "task.amended", task: done.task.id, fields: Object.keys(done.amendment.was), by: caller.id });
    const { was } = done.amendment;
    const widened = Array.isArray(was.owned) ? done.task.owned.filter((path) => !was.owned!.includes(path)) : [];
    if (widened.length > 0) await tellMoment(desk, caller.project, done.task, "ARCHITECTURE", `its Lead widened what it owns by ${widened.join(", ")}, because ${str(args.why)}`);
    if (typeof was.goal === "string") await tellMoment(desk, caller.project, done.task, "TURNING", `its Lead changed what it is for, because ${str(args.why)}\nwas: ${was.goal}\nnow: ${done.task.goal}`);
    if (done.task.status === "waiting") return ok(`${done.task.id} is amended; it starts as it is now.`);
    const posted = await ctx.post(done.task.peer, letters.amended(done.task, done.amendment, "worker"));
    return ok(`${done.task.id} is amended${posted === "nobody" ? ", and it has no Peer to tell" : "; its Peer has it at its next turn"}.`);
  },
});
