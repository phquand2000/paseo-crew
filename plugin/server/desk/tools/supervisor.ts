import { configFault } from "../../core/config-file.ts";
import { branchExists, currentBranch, isAncestor, landLane, trackedFiles } from "../../core/git.ts";
import { roleThatCan } from "../../catalog/kit.ts";
import { docsDir, placeDoc } from "../../catalog/templates.ts";
import { firstOverlap, serialPaths, serialReach } from "../../core/scope.ts";
import { type Args, type Caller, errorText, no, ok, str, strs } from "../context.ts";
import { laneGate } from "../gates.ts";
import { type Issue, fetchIssue } from "../issue.ts";
import { type Lane, type Task, findLane, loadLedger, nextLaneId, slugify, tasksOf } from "../ledger.ts";
import { clip, letters, outside } from "../letters.ts";
import { type Project, type ProjectConfig, configFile, detectGate, loadConfig, saveConfig } from "../project.ts";
import type { DeskServices, Tool } from "../services.ts";
import { namedOrNot } from "./shared.ts";

function scopeProblem(serial: string[], open: Lane[], writeSet: string[], contracts: string[]): string | undefined {
  if (open.length === 0) return undefined;
  const mine = serialReach(writeSet, serial);
  for (const other of open) {
    // A lane that declared no write set could be writing any of them, and a working copy of its own
    // does not help here: these are the files a merge cannot reconcile, so the second writer loses.
    const theirs = other.writeSet.length === 0 ? serial : serialReach(other.writeSet, serial);
    const both = mine.filter((path) => theirs.includes(path));
    // Named, not listed: the rules are resolved against real files, and a Unity or Unreal tree has
    // tens of thousands of them. A refusal that spends the seat's context cannot be acted on.
    if (both.length > 0)
      return `Lane ${other.id} may already be writing ${both.slice(0, 4).join(", ")}${both.length > 4 ? ` and ${both.length - 4} more` : ""}, and only one lane at a time may write those; open this lane after ${other.id} lands, or keep those paths out of it.`;
  }
  // Two lanes that declared the same paths are one lane the Supervisor has not noticed yet. Nothing
  // is said when either declared nothing: that is the Supervisor's call, not a hole to refuse over.
  for (const other of open) {
    if (writeSet.length === 0 || other.writeSet.length === 0) continue;
    const clash = firstOverlap(writeSet, [...other.writeSet, ...other.contracts]) ?? firstOverlap(contracts, other.writeSet);
    if (clash) return `This lane overlaps lane ${other.id} at ${clash}; fold it in or open it after ${other.id} lands.`;
  }
  return undefined;
}

/**
 * The issue, or why it could not be read — which is a note on the lane, not a reason to refuse one.
 *
 * `issue` is optional in the tool's schema and the lane keeps only its url, so a ref the desk could
 * not resolve — `gh` not installed, not logged in, a host the reader did not recognise, a number that
 * is not there — used to abort `open_lane` entirely. The Supervisor got no lane, and nothing said the
 * only thing that had actually failed was reading a link.
 */
async function readIssue(args: Args, project: Project): Promise<{ issue?: Issue; unread?: string }> {
  const ref = str(args.issue);
  if (!ref) return {};
  const fetched = await fetchIssue(ref, project.root);
  return "error" in fetched ? { unread: `${ref} could not be read: ${fetched.error}` } : { issue: fetched };
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
      detourOf: str(args.detourOf).trim().toUpperCase() || undefined,
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

/** Which gate regime this project runs, because a Lead plans its splits against it. */
function gateRegime(project: Project): string {
  const config = loadConfig(project.state);
  if (!config.gate) return "none set, so nothing is checked for you";
  return config.gateOn === "task" ? `${config.gate} runs on every task, and its verdict reaches the Lead with the hand-back — evidence, not a veto` : `${config.gate} runs on the whole lane when you report it ready`;
}

function openedReply(project: Project, lane: Lane, slot: { id?: string }, lead: string, issue: Issue | undefined): string {
  // An empty gate is the owner's answer, not a missing one, so it is not an invitation to set one.
  const stored = loadConfig(project.state).gate;
  const gate = stored ? stored : stored === "" ? "none set, by this project's own choice" : "none; call set_project with the project's test command";
  const issueText = issue
    ? `\n\nIssue #${issue.number} as the Lead received it: ${outside("issue", issue.title, 200)} (${outside("issue", issue.url, 300)})\n<issue>\n${outside("issue", issue.body, 4000)}\n</issue>`
    : "";
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
  // Seeded only where the owner has answered nothing at all. `config.gate` is "" when they answered
  // "no gate", and detecting one over that answers for them about what may land.
  if (!config.base || config.gate === undefined) {
    const fault = configFault(configFile(project.state));
    if (fault) return no(`${fault}\nOnly the Human can repair it or move it aside — no seat may write the desk's own files — so tell them; the desk will not write its own defaults over a file it could not read.`);
    saveConfig(project.state, { ...config, base: config.base ?? base, gate: config.gate ?? detectGate(project.root) });
  }
  const open = Object.values(loadLedger(project.state).lanes).filter((lane) => lane.status === "open");
  // One checkout is one branch: a second lane switching the project's own copy would take the first
  // Lead with it, and its commits would land on this lane's branch. So the desk takes a copy for it
  // rather than refusing the lane, and isolate stays for a copy asked for when nothing is in the way.
  const ownCopy = args.isolate === true || open.some((lane) => !lane.slot);
  const detourOf = str(args.detourOf);
  // A detour that names nothing real is a lane nobody is waiting on, and the letter back out of it
  // would have nowhere to go.
  if (detourOf && !open.some((lane) => lane.id === detourOf.trim().toUpperCase())) return no(`There is no open lane ${detourOf} for this one to clear the way for.`);
  const serial = open.length > 0 ? serialPaths(await trackedFiles(project.root), config.serialOnly) : [];
  const problem = scopeProblem(serial, open, strs(args.writeSet), strs(args.contracts));
  if (problem) return no(problem);
  const { issue, unread } = await readIssue(args, project);
  const lane = await recordLane(desk, caller, args, base, issue);
  // Whatever the lane took has to go back, and a lane in the project's own copy took the owner's
  // repository: cleaning up by slot id alone left that copy on the lane's branch for good.
  const fail = async (reason: string, taken?: { id?: string }) => {
    await ctx.ledger(project, (ledger) => {
      const entry = ledger.lanes[lane.id];
      if (entry) Object.assign(entry, { status: "closed", closedAt: Date.now() });
    });
    if (taken?.id) await slots.release(project, taken.id, lane.branch, base);
    else if (taken) await slots.giveBack(project, base, lane.branch);
    return no(reason);
  };
  let slot: { id?: string; path: string; workspaceId?: string };
  try {
    slot = ownCopy ? await slots.acquire(project, lane.branch, base, { lane: lane.id }) : await slots.inPlace(project, lane.branch, base);
  } catch (error) {
    return fail(`The lane could not get a working copy: ${errorText(error)}`);
  }
  try {
    const askedLead = str(args.role);
    const leadRole = roleThatCan(ctx.kit, "lead", askedLead || undefined);
    if (!leadRole) return fail(namedOrNot(ctx.kit, "lead", askedLead, "lead a lane"), slot);
    const lead = await agents.start(project, slot, leadRole.role, {
      parent: caller.id,
      title: `${lane.id} ${lane.title}`,
      prompt: letters.directive(lane, issue, { names: config.docs, dir: docsDir(project.state) }, gateRegime(project)),
      labels: { "seatworks.lane": lane.id, "seatworks.role": leadRole.role },
    });
    await ctx.ledger(project, (ledger) => {
      const entry = ledger.lanes[lane.id];
      if (entry) Object.assign(entry, { lead, worktree: slot.path, slot: slot.id, workspaceId: slot.workspaceId });
      ledger.agents[lead] = { id: lead, role: leadRole.role, lane: lane.id };
    });
    ctx.event(project, { kind: "lane.opened", lane: lane.id, lead, branch: lane.branch, base, slot: slot.id ?? "in place" });
    return ok(`${openedReply(project, lane, slot, lead, issue)}${unread ? `\n\nThe issue was not read into the lane: ${clip(unread, 300)}. The Lead has the outcome and the checks; give it the issue yourself if it needs one.` : ""}`);
  } catch (error) {
    return fail(`The Lead could not start: ${errorText(error)}`, slot);
  }
};

export const closeLane: Tool = async ({ ctx, roster, slots, agents, merges }, caller, args) => {
  const { project } = caller;
  const ledger = loadLedger(project.state);
  const lane = findLane(ledger, str(args.lane));
  if (!lane) return no(`There is no lane ${str(args.lane)}.`);
  if (lane.status !== "open") return no(`Lane ${lane.id} is already closed.`);
  // An accept on a parallel task queues its merge and returns at once, and that merge runs `git
  // merge` in the lane's own working copy. Closing the lane meanwhile ran the gate in that copy,
  // landed its branch and then removed the directory the merge was standing in. `settled` was
  // written for this and nothing outside the tests had ever called it.
  await merges.settled(project);
  let landing = `the branch ${lane.branch} is kept for the Human`;
  if (args.land === true) {
    const gate = await laneGate(ctx, project, lane);
    // A red gate stops the landing by default, and landing over it is the Supervisor's to decide — the
    // verdict is evidence. There was no way to say so: the only choices were not to land at all, or to
    // wait for a green the Supervisor may have decided it did not need.
    if (!gate.ok && args.overGate !== true) {
      return no(`Lane ${lane.id} was not closed: ${gate.text}\nMessage its Lead, close it with land false, or land it over the gate with overGate true — that is your call.`);
    }
    if (!gate.ok) ctx.event(project, { kind: "gate.overridden", lane: lane.id, by: caller.id });
    // Where `base` has moved on, landing is a merge, and a merge needs a working copy standing on
    // base. For a lane working in place the desk itself put the project's own copy on the lane's
    // branch, so that read refused every such lane over an arrangement the desk made and undid a
    // moment later. It may be moved back only while nobody is mid-turn in it: what a seat writes
    // there is its own until its turn ends, which is what the teardown waits for.
    // Asked of the seats themselves. The first version of this read `pendingArchive`, which fills only
    // when an archive finds a seat running — and nothing in this lane had been archived yet — so it was
    // empty every time, and the owner's copy was switched to base under a seat mid-turn whose next
    // commit then landed on base itself. A seat the desk cannot see counts as writing.
    const writers = [lane.lead, ...tasksOf(ledger, lane.id).filter((task) => task.mode !== "parallel").map((task) => task.peer)];
    const writing = await Promise.all(
      writers.map(async (id) => {
        if (typeof id !== "string") return false;
        try {
          const seat = await roster.look(id);
          return !seat.archivedAt && (seat.status === "running" || seat.status === "initializing");
        } catch {
          return true;
        }
      }),
    );
    const parked = !lane.slot && !writing.some(Boolean) ? lane.branch : undefined;
    // A merge the copy cannot be moved for is refused before anything is closed. Closed first, the lane
    // could not be closed again, so a landing that only had to wait for one turn to end was lost for
    // good, under git's reason rather than the real one.
    if (!lane.slot && !parked && !(await isAncestor(project.root, lane.base, lane.branch))) {
      return no(
        `Lane ${lane.id} was not closed: ${lane.base} has moved on, so landing it is a merge in the project's own copy, and a seat is mid-turn there. Close it again once that turn ends, or close it with land false.`,
      );
    }
    const result = await landLane(project.root, lane.base, lane.branch, parked);
    landing = result.landed ? `${result.how}${gate.ok ? "" : ", over a red gate"}; ${lane.branch} is kept` : `not landed: ${result.how}; ${lane.branch} is kept for the Human`;
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
  const kept: string[] = [];
  for (const task of retired) {
    const branch = await agents.retire(project, task, lane.branch);
    if (branch) kept.push(branch);
  }
  await roster.archive(lane.lead);
  await roster.retireWatcher(project);
  // Whoever is mid-turn is still writing in the lane's copy, and what they write is theirs until
  // their turn ends; the copy goes away then, not under them.
  const writers = [lane.lead, ...retired.filter((task) => task.mode !== "parallel").map((task) => task.peer)].filter(
    (id): id is string => typeof id === "string" && roster.pendingArchive.has(id),
  );
  const branch = await slots.putAway({ project, slot: lane.slot, restore: lane.base, lane: lane.id, branch: lane.branch }, writers);
  if (branch) kept.push(branch);

  if (lane.detourOf) {
    const waiting = loadLedger(project.state).lanes[lane.detourOf];
    if (waiting?.status === "open" && waiting.lead) await ctx.post(waiting.lead, `detour:${lane.id}:${Date.now()}`, letters.detourLanded(lane, waiting, landing));
  }
  ctx.event(project, { kind: "lane.closed", lane: lane.id, land: args.land === true, landing, reason: str(args.reason), writers });
  const copy =
    writers.length > 0
      ? `Its working copy is put away once ${writers.join(" and ")} finish the turn they are in.`
      : "Its working copy is free for the next lane.";
  const branches = kept.length > 0 ? ` ${kept.join(" and ")} ${kept.length === 1 ? "holds commits" : "hold commits"} nothing else has and ${kept.length === 1 ? "is" : "are"} kept.` : "";
  return ok(`Lane ${lane.id} closed and its agents archived; ${landing}. ${copy}${branches}`);
};

export const setProject: Tool = async ({ ctx }, caller, args) => {
  // Refused as open_lane refuses: read as all defaults, an unreadable file was saved over with them.
  const unreadable = configFault(configFile(caller.project.state));
  if (unreadable) return no(`${unreadable}\nOnly the Human can repair it or move it aside; nothing was saved over it.`);
  const config = loadConfig(caller.project.state);
  const shelf = ctx.kit.templates;
  const asked = strs(args.docs);
  const unknown = asked.filter((name) => !shelf[name]);
  if (unknown.length > 0) {
    return no(`This kit has no page called ${unknown.join(", ")}. It has: ${Object.keys(shelf).sort().join(", ")}.`);
  }
  const base = str(args.base);
  if (base && !(await branchExists(caller.project.root, base))) return no(`The branch ${base} does not exist.`);
  const minutes = Number(args.gateTimeoutMinutes);
  const next: ProjectConfig = {
    ...config,
    base: base || config.base,
    gate: typeof args.gate === "string" ? args.gate.trim() : config.gate,
    gateTimeoutMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : config.gateTimeoutMinutes,
    gateOn: args.gateOn === "task" ? "task" : args.gateOn === "lane" ? "lane" : config.gateOn,
    serialOnly: Array.isArray(args.serialOnly) ? strs(args.serialOnly) : config.serialOnly,
    docs: args.docs === undefined ? config.docs.filter((name) => shelf[name]) : asked,
  };
  saveConfig(caller.project.state, next);
  // A page nobody asked for is never written, and a page already written is never written over.
  const placed = next.docs.flatMap((name) => (shelf[name] ? [{ name, ...placeDoc(caller.project.state, shelf[name]) }] : []));
  const started = placed.filter((entry) => entry.written).map((entry) => `${entry.name} (${entry.file})`);
  const kept = Object.keys(shelf).filter((name) => !next.docs.includes(name));
  const pages =
    next.docs.length === 0
      ? `\nPages kept: none. On the shelf, unused: ${kept.sort().join(", ")}.`
      : `\nPages kept: ${next.docs.join(", ")}.${started.length > 0 ? ` Started: ${started.join("; ")}.` : ""}${kept.length > 0 ? ` On the shelf, unused: ${kept.sort().join(", ")}.` : ""}`;
  return ok(`Base ${next.base ?? "unset"}; gate ${next.gate || "none"}, run per ${next.gateOn}; gate timeout ${next.gateTimeoutMinutes} minutes.${pages}`);
};
