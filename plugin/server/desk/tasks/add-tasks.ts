import { skillSources } from "../../catalog/kit/content.ts";
import type { Kit, RoleSpec } from "../../catalog/kit/kit.ts";
import { namedOrNot, roleThatCan } from "../../catalog/kit/roles.ts";
import { type Team, skillDirsFor } from "../../catalog/team/team.ts";
import { clip, plural, slugify } from "../../core/text.ts";
import { type Args, type Caller, type ToolReply, no, ok, str, strs } from "../context.ts";
import { holdRefusal } from "../lanes/hold.ts";
import { keptFor } from "../seats/kept.ts";
import { type Lane, loseReady } from "../../domain/lane.ts";
import { type Ledger, laneOfLead, nextTaskId } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { serialIn } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { startWaiting } from "../waiting/tasks.ts";
import { type Planned, layoutProblems, readPlan } from "./layout.ts";
import { hintedNote, outsideNote } from "./placement.ts";

/** One task as add_tasks takes it, in the Lead's own key. */
type AskedTask = Args & { key: string };

/** Adds tasks to the Lead's lane in one go, each waiting for what it names, and starts what can start. */
export async function addTasks(desk: DeskServices, caller: Caller, asked: AskedTask[]): Promise<ToolReply> {
  const { project } = caller;
  const lane = laneOfLead(loadLedger(project.state), caller.id);
  if (!lane?.worktree) return no("You have no open lane.");
  const roles = rolesFor(desk.kit, desk.teamFor(project), asked);
  if (typeof roles === "string") return no(roles);
  const serial = await serialIn(desk.kit, project, lane.worktree);
  const added = record(desk, caller, asked, roles, serial);
  if (typeof added === "string") return no(added);
  const { plan, ids } = added;
  recordEvent(project, { kind: "tasks.added", lane: lane.id, tasks: [...ids.values()] });
  await startWaiting(desk, project, true, new Set(ids.values()));
  const now = loadLedger(project.state).tasks;
  const lines = plan.map((task) => {
    const entry = now[ids.get(task.key)!]!;
    const running = `${entry.status}${entry.peer ? `, Peer ${entry.peer}` : ""}`;
    const state = entry.held
      ? `held: ${clip(entry.held.why, 200)}`
      : entry.status === "waiting"
        ? `waits for ${entry.after!.join(", ")}`
        : running;
    return `- ${task.key} is ${entry.id} ${entry.title}: ${state}`;
  });
  const notes = plan.flatMap((task) => [outsideNote(lane, task.key, task.holds), hintedNote(task.key, task.hinted)]);
  const said = notes.filter((note) => note !== undefined);
  const noted = said.length > 0 ? `\n\n${said.map((note) => `Note: ${note}`).join("\n")}` : "";
  return ok(
    `Added; each task starts by itself once what it waits for is merged, and hand-backs arrive as mail.\n${lines.join("\n")}${noted}`,
  );
}

/** The role taking each task, by key, or why one cannot be taken. */
function rolesFor(kit: Kit, team: Team, asked: AskedTask[]): Map<string, string> | string {
  const roles = new Map<string, string>();
  for (const task of asked) {
    const key = task.key.trim().toUpperCase();
    const role = workRoleFor(kit, team, task);
    if (typeof role === "string") return `${key}: ${role}`;
    roles.set(key, role.role);
  }
  return roles;
}

/** The role that takes a task, or why none can: a skill it lacks is refused here, since the Lead's context does not list them. */
export function workRoleFor(kit: Kit, team: Team, args: Args): RoleSpec | string {
  // Writing, not `work`: a reviewing role holds `work` too, and would be offered as a Peer that cannot write.
  const asked = str(args.role);
  const workRole = roleThatCan(kit, "write", asked || undefined);
  if (!workRole) return namedOrNot(kit, "write", asked, "take a task");
  const held = [...skillSources(kit, workRole, skillDirsFor(team, workRole.role)).keys()];
  const unknown = strs(args.skills).filter((name) => !held.includes(name));
  if (unknown.length === 0) return workRole;
  if (held.length === 0)
    return `This kit gives ${workRole.label}s no skills, so ${unknown.join(", ")} cannot be opened.`;
  return `${workRole.label}s have no skill called ${unknown.join(", ")}. They have: ${held.sort().join(", ")}.`;
}

type Recorded = { plan: Planned[]; ids: Map<string, string> };

/** Checked and recorded in one transaction: a layout read before another call recorded its tasks could put two writers on a path. */
function record(
  { ledgers }: Pick<DeskServices, "ledgers">,
  caller: Caller,
  asked: AskedTask[],
  roles: Map<string, string>,
  serial: string[],
): Recorded | string {
  return ledgers.transact(caller.project, (ledger) => {
    const now = laneOfLead(ledger, caller.id);
    if (!now) return "You have no open lane.";
    const held = holdRefusal(now);
    if (held) return held;
    const plan = readPlan(ledger, now, asked);
    if (typeof plan === "string") return plan;
    const problems = layoutProblems(ledger, now, plan, serial);
    if (problems.length > 0) {
      const these = plural(problems.length, "this", "these");
      const list = problems.map((problem) => `- ${problem}`).join("\n");
      return `No task was added, since ${these} would put two writers on one path:\n${list}`;
    }
    const unkept = keptProblems(ledger, now, plan, roles);
    if (unkept.length > 0) return `No task was added:\n${unkept.map((problem) => `- ${problem}`).join("\n")}`;
    const ids = new Map<string, string>();
    for (const task of plan) {
      const after = task.after.map((id) => ids.get(id) ?? id);
      ids.set(task.key, recordTask(ledger, now, task, { after, role: roles.get(task.key)! }));
    }
    // New work: what the lane was reported ready as is not what it will hold.
    loseReady(now);
    return { plan, ids };
  });
}

/** Why a task cannot start on the kept Peer it names: one in the lane's copy, whose Peer no other task is promised. */
function keptProblems(ledger: Ledger, lane: Lane, plan: Planned[], roles: Map<string, string>): string[] {
  const promised = new Map<string, string>();
  for (const task of Object.values(ledger.tasks))
    if (task.status === "waiting" && task.opening?.peer) promised.set(task.opening.peer, task.id);
  return plan.flatMap(({ key, args, parallel }) => {
    const named = str(args.peer).trim().toUpperCase();
    if (!named) return [];
    if (parallel) return [`${key} runs beside others in a copy of its own, and a kept Peer works in the lane's.`];
    const source = ledger.tasks[named]?.lane === lane.id ? ledger.tasks[named] : undefined;
    const kept = keptFor(ledger, source, roles.get(key)!);
    if (typeof kept === "string") return [`${key} names the Peer kept from ${named}, which ${kept}.`];
    const other = promised.get(named);
    promised.set(named, key);
    return other ? [`${key} names the Peer kept from ${named}, which ${other} starts on already.`] : [];
  });
}

/** Puts the task as asked for on record in `ledger`, waiting for what it names, and gives its id; `startWaiting` starts it. */
function recordTask(
  ledger: Ledger,
  lane: Lane,
  { args, parallel, hints, holds }: Planned,
  waits: { after: string[]; role: string },
): string {
  const peer = str(args.peer).trim().toUpperCase() || undefined;
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
    hints,
    holds,
    outOfScope: strs(args.outOfScope),
    context: str(args.context) || undefined,
    skills: strs(args.skills),
    // Every task writes on a branch of its own, one beside others in a copy of its own too: the lane branch takes only merges.
    branch: `task/${id.toLowerCase()}-${slugify(title, 24)}`,
    worktree: parallel ? undefined : lane.worktree,
    slot: parallel ? undefined : lane.slot,
    takeBase: args.takeBase === true ? true : undefined,
    planFirst: args.planFirst === true ? true : undefined,
    status: "waiting",
    after: waits.after,
    // Who takes it, kept for when it starts: the call that asked for it is long gone by then.
    opening: { role: waits.role, peer },
    openedAt: now,
    updatedAt: now,
    silent: 0,
  };
  return id;
}
