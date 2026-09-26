import { recordEvent } from "../store/event-log.ts";
import { z } from "zod";
import { skillSources } from "../../catalog/content.ts";
import { type RoleSpec, namedOrNot, roleThatCan } from "../../catalog/kit.ts";
import { skillDirsFor } from "../../catalog/team.ts";
import { clip, slugify } from "../../core/text.ts";
import type { DeskBase } from "../base.ts";
import { type Args, no, ok, str, strs } from "../context.ts";
import { holdRefusal } from "../hold.ts";
import { type Lane, type Ledger, laneOfLead, loadLedger, nextTaskId } from "../ledger.ts";
import { layoutProblems, readPlan } from "../plan.ts";
import { type Project, serialIn } from "../project.ts";
import { defineTool } from "../services.ts";
import { startWaiting } from "../waiting/tasks.ts";

const Asked = z.strictObject({ key: z.string(), title: z.string().max(60), goal: z.string(), acceptance: z.array(z.string()), hints: z.array(z.string()).optional(), holds: z.array(z.string()).optional(), outOfScope: z.array(z.string()), context: z.string().optional(), skills: z.array(z.string()).optional(), parallel: z.boolean().optional(), after: z.array(z.string()).optional(), role: z.string().optional() });

/** The role that takes a task, or why none can: a skill it lacks is refused here, since the Lead's context does not list them. */
function workRoleFor({ kit, teamFor }: Pick<DeskBase, "kit" | "teamFor">, project: Project, args: Args): RoleSpec | string {
  // Writing, not `work`: a reviewing role holds `work` too, and would be offered as a Peer that cannot write.
  const asked = str(args.role);
  const workRole = roleThatCan(kit, "write", asked || undefined);
  if (!workRole) return namedOrNot(kit, "write", asked, "take a task");
  const held = [...skillSources(kit, workRole, skillDirsFor(teamFor(project), workRole.role)).keys()];
  const unknown = strs(args.skills).filter((name) => !held.includes(name));
  if (unknown.length === 0) return workRole;
  return held.length === 0 ? `This kit gives ${workRole.label}s no skills, so ${unknown.join(", ")} cannot be opened.` : `${workRole.label}s have no skill called ${unknown.join(", ")}. They have: ${held.sort().join(", ")}.`;
}

/** Puts the task as asked for on record in `ledger`, waiting for what it names, and gives its id; `startWaiting` starts it. */
function recordTask(ledger: Ledger, lane: Lane, args: Args, parallel: boolean, waits: { after: string[]; role: string }): string {
  const title = str(args.title);
  const id = nextTaskId(lane, "code");
  const now = Date.now();
  ledger.tasks[id] = {
    id,
    lane: lane.id,
    kind: "code",
    mode: parallel ? "parallel" : "lane",
    title,
    goal: str(args.goal),
    acceptance: strs(args.acceptance),
    hints: strs(args.hints),
    holds: strs(args.holds),
    outOfScope: strs(args.outOfScope),
    context: str(args.context) || undefined,
    skills: strs(args.skills),
    // Every task writes on a branch of its own, one beside others in a copy of its own too: the lane branch takes only merges.
    branch: `task/${id.toLowerCase()}-${slugify(title, 24)}`,
    worktree: parallel ? undefined : lane.worktree,
    slot: parallel ? undefined : lane.slot,
    status: "waiting",
    after: waits.after,
    // Who takes it, kept for when it starts: the call that asked for it is long gone by then.
    opening: { role: waits.role },
    openedAt: now,
    updatedAt: now,
    silent: 0,
  };
  return id;
}

/** Adds tasks to the Lead's lane in one go, each waiting for what it names, and starts what can start; a layout holding one path twice is refused. */
export const addTasks = defineTool({
  name: "add_tasks",
  input: z.strictObject({ tasks: z.array(Asked) }),
  async handle(desk, caller, args) {
    const { kit, ledgers } = desk;
    const { project } = caller;
    const lane = laneOfLead(loadLedger(project.state), caller.id);
    if (!lane?.worktree) return no("You have no open lane.");
    const roles = new Map<string, string>();
    for (const task of args.tasks) {
      const key = task.key.trim().toUpperCase();
      const role = workRoleFor(desk, project, task);
      if (typeof role === "string") return no(`${key}: ${role}`);
      roles.set(key, role.role);
    }
    const serial = await serialIn(kit, project, lane.worktree);
    // Checked and recorded in one transaction: a layout read before another call recorded its tasks could put two writers on a path.
    const added = ledgers.transact(project, (ledger) => {
      const now = laneOfLead(ledger, caller.id);
      if (!now) return "You have no open lane.";
      const held = holdRefusal(now);
      if (held) return held;
      const plan = readPlan(ledger, now, args.tasks);
      if (typeof plan === "string") return plan;
      const problems = layoutProblems(ledger, now, plan, serial);
      if (problems.length > 0) return `No task was added, since ${problems.length === 1 ? "this" : "these"} would have two tasks hold one path or hold one the lane does not write:\n${problems.map((problem) => `- ${problem}`).join("\n")}`;
      const ids = new Map<string, string>();
      for (const task of plan) ids.set(task.key, recordTask(ledger, now, task.args, task.parallel, { after: task.after.map((id) => ids.get(id) ?? id), role: roles.get(task.key)! }));
      // New work: what the lane was reported ready as is not what it will hold.
      delete now.ready;
      return { plan, ids };
    });
    if (typeof added === "string") return no(added);
    const { plan, ids } = added;
    recordEvent(project, { kind: "tasks.added", lane: lane.id, tasks: [...ids.values()] });
    await startWaiting(desk, project, true, new Set(ids.values()));
    const now = loadLedger(project.state).tasks;
    const lines = plan.map((task) => {
      const entry = now[ids.get(task.key)!]!;
      const state = entry.held ? `held: ${clip(entry.held.why, 200)}` : entry.status === "waiting" ? `waits for ${entry.after!.join(", ")}` : `${entry.status}${entry.peer ? `, Peer ${entry.peer}` : ""}`;
      return `- ${task.key} is ${entry.id} ${entry.title}: ${state}`;
    });
    return ok(`Added; each task starts by itself once what it waits for is merged, and hand-backs arrive as mail.\n${lines.join("\n")}`);
  },
});
