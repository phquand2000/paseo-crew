import { branchExists, currentBranch, landLane } from "../../core/git.ts";
import { firstOverlap, serialHits } from "../../core/scope.ts";
import { type Args, type Caller, errorText, no, ok, str, strs } from "../context.ts";
import { laneGate } from "../gates.ts";
import { type Issue, fetchIssue } from "../issue.ts";
import { type Lane, type Slot, type Task, findLane, loadLedger, nextLaneId, slugify } from "../ledger.ts";
import { clip, letters } from "../letters.ts";
import { type Project, type ProjectConfig, detectGate, loadConfig, saveConfig } from "../project.ts";
import type { DeskServices, Tool } from "../services.ts";

function scopeProblem(config: ProjectConfig, open: Lane[], writeSet: string[], contracts: string[]): string | undefined {
  if (open.length >= config.parallelLanes) {
    const plural = open.length === 1 ? " is" : "s are";
    return `${open.length} lane${plural} open and this project runs ${config.parallelLanes} at a time. Fold this outcome into ${open[0]?.id ?? "the open lane"} with message, wait for it to land, or raise parallelLanes with set_project only if the work is genuinely independent.`;
  }
  if (open.length === 0) return undefined;
  if (writeSet.length === 0) return "Another lane is open, so this lane needs writeSet (and contracts) to prove it doesn't overlap.";
  const serial = serialHits(writeSet, config.serialOnly);
  if (serial.length > 0) return `writeSet includes paths that only one lane at a time may write (${serial.join(", ")}); open this lane after the current one lands.`;
  for (const other of open) {
    if (other.writeSet.length === 0) return `Lane ${other.id} declared no writeSet, so it may write anywhere; open this lane after it lands.`;
    const clash = firstOverlap(writeSet, [...other.writeSet, ...other.contracts]) ?? firstOverlap(contracts, other.writeSet);
    if (clash) return `This lane overlaps lane ${other.id} at ${clash}; fold it in or open it after ${other.id} lands.`;
  }
  return undefined;
}

async function readIssue(args: Args, project: Project): Promise<Issue | string | undefined> {
  const ref = str(args.issue);
  if (!ref) return undefined;
  const fetched = await fetchIssue(ref, project.root);
  return "error" in fetched ? `Issue ${ref} could not be read: ${fetched.error}` : fetched;
}

function recordLane(desk: DeskServices, caller: Caller, args: Args, base: string, issue: Issue | undefined): Promise<Lane> {
  const title = str(args.title);
  return desk.ctx.ledger(caller.project, (ledger) => {
    const id = nextLaneId(ledger);
    const lane: Lane = {
      id,
      title,
      outcome: str(args.outcome),
      acceptance: strs(args.acceptance),
      appetite: str(args.appetite) || undefined,
      deadline: str(args.deadline) || undefined,
      outOfScope: strs(args.outOfScope),
      issue: issue?.url,
      base,
      branch: `lane/${id.toLowerCase()}-${slugify(title, 24)}`,
      writeSet: strs(args.writeSet),
      contracts: strs(args.contracts),
      opener: caller.id,
      status: "open",
      openedAt: Date.now(),
      tasks: 0,
    };
    ledger.lanes[id] = lane;
    return { ...lane };
  });
}

function openedReply(project: Project, lane: Lane, slot: Slot, lead: string, issue: Issue | undefined): string {
  const gate = loadConfig(project.state).gate ?? "none; call set_project with the project's test command";
  const issueText = issue ? `\n\nIssue #${issue.number} as the Lead received it: ${issue.title} (${issue.url})\n<issue>\n${clip(issue.body, 4000)}\n</issue>` : "";
  return `Lane ${lane.id} is open on ${lane.branch} (off ${lane.base}) in working copy ${slot.id}, and its Lead ${lead} is starting. Gate: ${gate}. Reports and asks arrive as mail; nothing to wait for now.${issueText}`;
}

export const openLane: Tool = async (desk, caller, args) => {
  const { ctx, slots, agents } = desk;
  const { project } = caller;
  if (!str(args.title) || !str(args.outcome) || strs(args.acceptance).length === 0 || strs(args.outOfScope).length === 0)
    return no("open_lane needs a title, an outcome, at least one acceptance check and what is out of scope.");
  const config = loadConfig(project.state);
  const base = str(args.base) || config.base || (await currentBranch(project.root)) || "main";
  if (!(await branchExists(project.root, base))) return no(`The base branch ${base} does not exist.`);
  if (!config.base || !config.gate) saveConfig(project.state, { ...config, base: config.base ?? base, gate: config.gate ?? detectGate(project.root) });
  const open = Object.values(loadLedger(project.state).lanes).filter((lane) => lane.status === "open");
  const problem = scopeProblem(config, open, strs(args.writeSet), strs(args.contracts));
  if (problem) return no(problem);
  const issue = await readIssue(args, project);
  if (typeof issue === "string") return no(issue);
  const lane = await recordLane(desk, caller, args, base, issue);
  const fail = async (reason: string, slot?: string) => {
    await ctx.ledger(project, (ledger) => {
      const entry = ledger.lanes[lane.id];
      if (entry) Object.assign(entry, { status: "closed", closedAt: Date.now() });
    });
    if (slot) await slots.release(project, slot, lane.branch);
    return no(reason);
  };
  let slot: Slot;
  try {
    slot = await slots.acquire(project, lane.branch, base, { lane: lane.id });
  } catch (error) {
    return fail(`The lane could not get a working copy: ${errorText(error)}`);
  }
  try {
    const lead = await agents.start(project, slot, "lead", {
      parent: caller.id,
      title: `${lane.id} ${lane.title}`,
      prompt: letters.directive(lane, issue),
      labels: { "seatworks.lane": lane.id, "seatworks.role": "lead" },
    });
    await ctx.ledger(project, (ledger) => {
      const entry = ledger.lanes[lane.id];
      if (entry) Object.assign(entry, { lead, worktree: slot.path, slot: slot.id });
      ledger.agents[lead] = { id: lead, role: "lead", lane: lane.id };
    });
    ctx.event(project, { kind: "lane.opened", lane: lane.id, lead, branch: lane.branch, base, slot: slot.id });
    return ok(openedReply(project, lane, slot, lead, issue));
  } catch (error) {
    return fail(`The Lead could not start: ${errorText(error)}`, slot.id);
  }
};

export const closeLane: Tool = async ({ ctx, roster, slots, agents }, caller, args) => {
  const { project } = caller;
  const lane = findLane(loadLedger(project.state), str(args.lane));
  if (!lane) return no(`There is no lane ${str(args.lane)}.`);
  if (lane.status !== "open") return no(`Lane ${lane.id} is already closed.`);
  let landing = `the branch ${lane.branch} is kept for the Human`;
  if (args.land === true) {
    const gate = await laneGate(ctx, project, lane);
    if (!gate.ok) return no(`Lane ${lane.id} was not closed: ${gate.text}\nMessage its Lead, or close it with land false.`);
    const result = await landLane(project.root, lane.base, lane.branch);
    landing = result.landed ? `${result.how}; ${lane.branch} is kept` : `not landed: ${result.how}; ${lane.branch} is kept for the Human`;
  }
  const retired = await ctx.ledger(project, (current) => {
    const entry = current.lanes[lane.id];
    if (entry) Object.assign(entry, { status: "closed", closedAt: Date.now() });
    const tasks: Task[] = [];
    for (const task of Object.values(current.tasks).filter((item) => item.lane === lane.id)) {
      if (["running", "rework", "queued", "done", "failed", "stalled"].includes(task.status)) task.status = "cut";
      tasks.push({ ...task });
    }
    return tasks;
  });
  for (const task of retired) await agents.retire(project, task, task.status !== "merged");
  await roster.archive(lane.lead);
  if (!Object.values(loadLedger(project.state).lanes).some((entry) => entry.status === "open")) await roster.retireWatcher(project);
  await slots.release(project, lane.slot);
  ctx.event(project, { kind: "lane.closed", lane: lane.id, land: args.land === true, landing, reason: str(args.reason) });
  return ok(`Lane ${lane.id} closed and its agents archived; ${landing}. Its working copy is free for the next lane.`);
};

export const setProject: Tool = async (_desk, caller, args) => {
  const config = loadConfig(caller.project.state);
  const base = str(args.base);
  if (base && !(await branchExists(caller.project.root, base))) return no(`The branch ${base} does not exist.`);
  const minutes = Number(args.gateTimeoutMinutes);
  const lanes = Number(args.parallelLanes);
  const next: ProjectConfig = {
    ...config,
    base: base || config.base,
    gate: typeof args.gate === "string" ? args.gate.trim() || undefined : config.gate,
    gateTimeoutMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : config.gateTimeoutMinutes,
    gateOn: args.gateOn === "task" ? "task" : args.gateOn === "lane" ? "lane" : config.gateOn,
    parallelLanes: Number.isInteger(lanes) && lanes > 0 ? lanes : config.parallelLanes,
    serialOnly: Array.isArray(args.serialOnly) ? strs(args.serialOnly) : config.serialOnly,
  };
  saveConfig(caller.project.state, next);
  return ok(`Base ${next.base ?? "unset"}; gate ${next.gate ?? "none"}, run per ${next.gateOn}; gate timeout ${next.gateTimeoutMinutes} minutes; ${next.parallelLanes} lane(s) at a time.`);
};
