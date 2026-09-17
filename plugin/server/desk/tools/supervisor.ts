import { branchExists, currentBranch, landLane } from "../../core/git.ts";
import { roleThatCan } from "../../catalog/kit.ts";
import { firstOverlap, serialHits } from "../../core/scope.ts";
import { type Args, type Caller, errorText, no, ok, str, strs } from "../context.ts";
import { laneGate } from "../gates.ts";
import { type Issue, fetchIssue } from "../issue.ts";
import { type Lane, type Task, findLane, loadLedger, nextLaneId, slugify } from "../ledger.ts";
import { clip, letters } from "../letters.ts";
import { type Project, type ProjectConfig, detectGate, loadConfig, saveConfig } from "../project.ts";
import type { DeskServices, Tool } from "../services.ts";

function scopeProblem(config: ProjectConfig, open: Lane[], sharing: Lane[], writeSet: string[], contracts: string[]): string | undefined {
  if (open.length === 0) return undefined;
  const serial = serialHits(writeSet, config.serialOnly);
  if (serial.length > 0) return `writeSet includes paths that only one lane at a time may write (${serial.join(", ")}); open this lane after the current one lands.`;
  if (sharing.length === 0) return undefined;
  if (writeSet.length === 0)
    return "Another lane is working in the project's own copy, so this lane needs writeSet (and contracts) to prove it doesn't overlap, or isolate to give it a working copy of its own.";
  for (const other of sharing) {
    if (other.writeSet.length === 0)
      return `Lane ${other.id} is working in the project's own copy and declared no writeSet, so what it writes is unknown; pass isolate to give this lane a copy of its own, or open it after ${other.id} lands.`;
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

function openedReply(project: Project, lane: Lane, slot: { id?: string }, lead: string, issue: Issue | undefined): string {
  const gate = loadConfig(project.state).gate ?? "none; call set_project with the project's test command";
  const issueText = issue ? `\n\nIssue #${issue.number} as the Lead received it: ${issue.title} (${issue.url})\n<issue>\n${clip(issue.body, 4000)}\n</issue>` : "";
  const where = slot.id ? `in working copy ${slot.id}` : "in the project's own working copy";
  return `Lane ${lane.id} is open on ${lane.branch} (off ${lane.base}) ${where}, and its Lead ${lead} is starting. Gate: ${gate}. Reports and asks arrive as mail; nothing to wait for now.${issueText}`;
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
  const isolate = args.isolate === true;
  const open = Object.values(loadLedger(project.state).lanes).filter((lane) => lane.status === "open");
  const sharing = isolate ? [] : open.filter((lane) => !lane.slot);
  const problem = scopeProblem(config, open, sharing, strs(args.writeSet), strs(args.contracts));
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
  let slot: { id?: string; path: string; workspaceId?: string };
  try {
    slot = isolate ? await slots.acquire(project, lane.branch, base, { lane: lane.id }) : await slots.inPlace(project, lane.branch, base);
  } catch (error) {
    return fail(`The lane could not get a working copy: ${errorText(error)}`);
  }
  try {
    const leadRole = roleThatCan(ctx.kit, "lead");
    if (!leadRole) return fail("No role in this kit can lead a lane.");
    const lead = await agents.start(project, slot, leadRole.role, {
      parent: caller.id,
      title: `${lane.id} ${lane.title}`,
      prompt: letters.directive(lane, issue),
      labels: { "seatworks.lane": lane.id, "seatworks.role": leadRole.role },
    });
    await ctx.ledger(project, (ledger) => {
      const entry = ledger.lanes[lane.id];
      if (entry) Object.assign(entry, { lead, worktree: slot.path, slot: slot.id, workspaceId: slot.workspaceId });
      ledger.agents[lead] = { id: lead, role: leadRole.role, lane: lane.id };
    });
    ctx.event(project, { kind: "lane.opened", lane: lane.id, lead, branch: lane.branch, base, slot: slot.id ?? "in place" });
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
  await roster.retireWatcher(project);
  if (lane.slot) await slots.release(project, lane.slot);
  else await slots.restore(project, lane.base);
  ctx.event(project, { kind: "lane.closed", lane: lane.id, land: args.land === true, landing, reason: str(args.reason) });
  return ok(`Lane ${lane.id} closed and its agents archived; ${landing}. Its working copy is free for the next lane.`);
};

export const setProject: Tool = async (_desk, caller, args) => {
  const config = loadConfig(caller.project.state);
  const base = str(args.base);
  if (base && !(await branchExists(caller.project.root, base))) return no(`The branch ${base} does not exist.`);
  const minutes = Number(args.gateTimeoutMinutes);
  const next: ProjectConfig = {
    ...config,
    base: base || config.base,
    gate: typeof args.gate === "string" ? args.gate.trim() || undefined : config.gate,
    gateTimeoutMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : config.gateTimeoutMinutes,
    gateOn: args.gateOn === "task" ? "task" : args.gateOn === "lane" ? "lane" : config.gateOn,
    serialOnly: Array.isArray(args.serialOnly) ? strs(args.serialOnly) : config.serialOnly,
  };
  saveConfig(caller.project.state, next);
  return ok(`Base ${next.base ?? "unset"}; gate ${next.gate ?? "none"}, run per ${next.gateOn}; gate timeout ${next.gateTimeoutMinutes} minutes.`);
};
