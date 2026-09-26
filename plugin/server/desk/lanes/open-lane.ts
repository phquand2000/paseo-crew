import type { Kit } from "../../catalog/kit/kit.ts";
import { configFault } from "../../core/config-file.ts";
import { branchExists, currentBranch, uncommittedPaths } from "../../core/git.ts";
import { clip, slugify } from "../../core/text.ts";
import { workKey } from "../claims.ts";
import { type Caller, type ToolReply, no, ok, str, strs } from "../context.ts";
import { type Issue, fetchIssue } from "../issue.ts";
import { type Lane, type Ledger, loadLedger, nextLaneId, ownCopyHolder } from "../ledger.ts";
import {
  type LaneHome,
  type Project,
  type ProjectConfig,
  configFile,
  detectGate,
  laneHomeFor,
  loadConfig,
  saveConfig,
  serialIn,
} from "../project.ts";
import type { Refusal } from "../refusal.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { waitsFor } from "../waiting/rules.ts";
import { openedReply, startLead } from "./lead-seat.ts";
import { placement } from "./placement.ts";

/** An open_lane call as the tool takes it. */
type OpenLaneCall = {
  title: string;
  outcome: string;
  acceptance: string[];
  appetite?: string;
  deadline?: string;
  outOfScope: string[];
  issue?: string;
  isolate?: boolean;
  base?: string;
  onBranch?: boolean;
  newBranch?: string;
  writeSet?: string[];
  contracts?: string[];
  after?: string[];
  detourOf?: string;
  role?: string;
};

type Place = { base: string; onBranch: boolean; branch?: string };

/** What the call comes to once checked: where the lane works, and the lanes it still waits for. */
type Plan = { args: OpenLaneCall; place: Place; after: string[]; pending: Lane[]; newBranch: string; here?: string };

/** Opens a lane now, or records it waiting for the lanes it names; a Lead is started for one that opens. */
export async function openLane(desk: DeskServices, caller: Caller, asked: OpenLaneCall): Promise<ToolReply> {
  const { project } = caller;
  const config = loadConfig(project.state);
  const plan = await planOpen(project, config, asked);
  if (typeof plan === "string") return no(plan);
  const fault = seedConfig(desk.kit, project, config, plan);
  if (fault) return no(fault);
  return plan.pending.length > 0 ? waitToOpen(desk, caller, plan) : openNow(desk, caller, plan);
}

/** Checks the call and works out where the lane works: carrying a branch on, or off which base. */
async function planOpen(project: Project, config: ProjectConfig, asked: OpenLaneCall): Promise<Plan | string> {
  const after = [...new Set(strs(asked.after).map((id) => id.trim().toUpperCase()))];
  const here = await currentBranch(project.root);
  const newBranch = str(asked.newBranch).trim();
  if (newBranch && asked.onBranch !== true && config.laneHome !== "onBranch")
    return "newBranch goes with onBranch: it starts the branch the lane then carries on.";
  if (asked.onBranch === true && (asked.isolate !== undefined || str(asked.base)))
    return "onBranch carries on the branch the project's own copy is on, in that copy, so it takes no base and no isolate.";
  // A lane whose `after` has all landed opens now, in whatever the copy is now: it is asked about like any other.
  const waits = after.length > 0 ? waitsFor(loadLedger(project.state), after, true) : [];
  const home = await homeOf(project, config, asked, Array.isArray(waits) && waits.length === 0, here);
  if (typeof home === "object") return home.refused;
  const args = { ...asked, onBranch: home === "onBranch" || undefined, isolate: home === "isolate" || undefined };
  const onBranch = args.onBranch === true;
  if (onBranch && !here)
    return "The project's own copy is not on a branch, so there is no branch to carry on; open the lane without onBranch to start one.";
  if (newBranch && after.length > 0)
    return "A lane that waits cannot start a branch from the copy as it is now: that is not the copy it will open in. Wait without newBranch, and start the branch when its turn comes.";
  if (newBranch && (await branchExists(project.root, newBranch)))
    return `The branch ${newBranch} already exists; carry it on after switching to it, or pick another name with the Human.`;
  const pending = after.length > 0 ? waitsFor(loadLedger(project.state), after, onBranch) : [];
  if (typeof pending === "string") return `${pending} Open this lane without waiting for it.`;
  const carried = pending.find((lane) => lane.onBranch)?.branch;
  const base = onBranch ? (carried ?? (newBranch || here!)) : str(args.base) || config.base || here || "main";
  if (!newBranch && !(await branchExists(project.root, base))) return `The base branch ${base} does not exist.`;
  return { args, place: { base, onBranch, branch: onBranch ? base : undefined }, after, pending, newBranch, here };
}

/** Where this lane works, as its call or the Human's standing choice says, or why the Human is asked first. */
async function homeOf(
  project: Project,
  config: ProjectConfig,
  asked: OpenLaneCall,
  opensNow: boolean,
  here: string | undefined,
): Promise<LaneHome | undefined | { refused: string }> {
  const said: LaneHome | undefined =
    asked.onBranch === true
      ? "onBranch"
      : asked.isolate === true
        ? "isolate"
        : asked.isolate === false || str(asked.base)
          ? "newBranch"
          : undefined;
  // A waiting lane opens into whatever the copy is by then, and one the copy is taken from takes a copy of its own or waits.
  if (!opensNow || ownCopyHolder(Object.values(loadLedger(project.state).lanes))) return said ?? config.laneHome;
  const home = laneHomeFor(said, config, here, await uncommittedPaths(project.root));
  if (typeof home !== "object") return home;
  return {
    refused: `The Human decides where this lane works, and has not said: ${home.question}. Ask them, and keep their answer for every lane with set_project laneHome if they give one.`,
  };
}

/** Seeded only when unanswered: the gate is "" when the owner answered "no gate", and a branch carried on is not a base. */
function seedConfig(kit: Kit, project: Project, config: ProjectConfig, plan: Plan): string | undefined {
  if (config.base && config.gate !== undefined) return undefined;
  const fault = configFault(configFile(project.state));
  if (fault)
    return `${fault}\nOnly the Human can repair it or move it aside — no seat may write the desk's own files — so tell them; the desk will not write its own defaults over a file it could not read.`;
  const base = config.base ?? (plan.place.onBranch ? undefined : plan.place.base);
  saveConfig(project.state, { ...config, base, gate: config.gate ?? detectGate(project.root, kit.ecosystem) });
  return undefined;
}

async function waitToOpen(desk: DeskServices, caller: Caller, plan: Plan): Promise<ToolReply> {
  const { project } = caller;
  const { issue } = await readIssue(plan.args, project);
  const lane = desk.ledgers.transact(project, (ledger) => {
    const entry = laneOf(ledger, caller, plan.args, plan.place, issue, plan.after);
    ledger.lanes[entry.id] = entry;
    return { ...entry };
  });
  recordEvent(project, { kind: "lane.waiting", lane: lane.id, after: plan.after });
  const waited = plan.pending.map((entry) => `${entry.id} (${entry.status})`).join(", ");
  return ok(
    `Lane ${lane.id} waits for ${waited}. It opens by itself once they have all landed, checked again against the lanes open then; if it cannot, or one closes without landing, you get a letter. Close it to drop it.`,
  );
}

async function openNow(desk: DeskServices, caller: Caller, plan: Plan): Promise<ToolReply> {
  const { project } = caller;
  const { args, place } = plan;
  const serial = await serialIn(desk.kit, project, project.root);
  // Asked before the issue is fetched, which a refusal would waste; recording the lane asks again.
  const asked = {
    onBranch: place.onBranch,
    writeSet: strs(args.writeSet),
    contracts: strs(args.contracts),
    detourOf: detourOf(args),
  };
  const early = placement(loadLedger(project.state), asked, args.isolate === true, serial);
  if ("why" in early) return no(`${early.why} ${early.next}`.trim());
  const { issue, unread } = await readIssue(args, project);
  const placed = recordOpen(desk, caller, plan, issue, serial);
  if ("why" in placed) return no(`${placed.why} ${placed.next}`.trim());
  const { lane } = placed;
  const from = plan.newBranch ? plan.here : undefined;
  const how = {
    ownCopy: placed.ownCopy,
    failed: "close" as const,
    from,
    role: str(args.role),
    parent: caller.id,
    issue,
  };
  const started = await startLead(desk, project, lane, how);
  if (typeof started === "string") return no(started);
  const note = unread
    ? `\n\nThe issue was not read into the lane: ${clip(unread, 300)}. The Lead has the outcome and the checks; give it the issue yourself if it needs one.`
    : "";
  return ok(`${openedReply(project, lane, started.slot, started.lead, issue, started.elsewhere)}${note}`);
}

/** Placed where it is recorded: two lanes opened at once would otherwise both find the project's own copy free. */
function recordOpen(
  desk: Pick<DeskServices, "ledgers" | "seating">,
  caller: Caller,
  plan: Plan,
  issue: Issue | undefined,
  serial: string[],
): { lane: Lane; ownCopy: boolean } | Refusal {
  return desk.ledgers.transact(caller.project, (ledger) => {
    const lane = laneOf(ledger, caller, plan.args, plan.place, issue);
    const placed = placement(ledger, lane, plan.args.isolate === true, serial);
    if ("why" in placed) return placed;
    ledger.lanes[lane.id] = lane;
    desk.seating.take(workKey(caller.project, lane.id));
    return { lane: { ...lane }, ownCopy: placed.ownCopy };
  });
}

const detourOf = (args: OpenLaneCall): string | undefined => str(args.detourOf).trim().toUpperCase() || undefined;

/** The lane as asked for, numbered in `ledger` but not yet on record there. */
function laneOf(
  ledger: Ledger,
  caller: Caller,
  args: OpenLaneCall,
  place: Place,
  issue: Issue | undefined,
  after?: string[],
): Lane {
  const title = str(args.title);
  const id = nextLaneId(ledger);
  const role = str(args.role);
  // What decides how it opens, kept for when it does: the call that asked for it is long gone by then.
  const opening =
    after && (args.isolate === true || role)
      ? { isolate: args.isolate === true || undefined, role: role || undefined }
      : undefined;
  return {
    id,
    title,
    outcome: str(args.outcome),
    acceptance: strs(args.acceptance),
    appetite: str(args.appetite) || undefined,
    deadline: str(args.deadline) || undefined,
    outOfScope: strs(args.outOfScope),
    issue: issue?.url,
    base: place.base,
    branch: place.branch ?? `lane/${id.toLowerCase()}-${slugify(title, 24)}`,
    detourOf: detourOf(args),
    onBranch: place.onBranch || undefined,
    writeSet: strs(args.writeSet),
    contracts: strs(args.contracts),
    opener: caller.id,
    status: after ? "waiting" : "open",
    after,
    opening,
    openedAt: Date.now(),
    tasks: 0,
  };
}

/** An unreadable issue ref is a note on the lane, never a reason to refuse opening it. */
async function readIssue(args: OpenLaneCall, project: Project): Promise<{ issue?: Issue; unread?: string }> {
  const ref = str(args.issue);
  if (!ref) return {};
  const fetched = await fetchIssue(ref, project.root);
  return "error" in fetched ? { unread: `${ref} could not be read: ${fetched.error}` } : { issue: fetched };
}
