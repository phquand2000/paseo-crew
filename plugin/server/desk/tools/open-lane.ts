import { z } from "zod";
import { configFault } from "../../core/config-file.ts";
import { branchExists, currentBranch, uncommittedPaths } from "../../core/git.ts";
import { type Args, type Caller, no, ok, str, strs } from "../context.ts";
import { type Issue, fetchIssue } from "../issue.ts";
import { type Lane, type Ledger, loadLedger, nextLaneId, ownCopyHolder } from "../ledger.ts";
import { clip, slugify } from "../../core/text.ts";
import { type LaneHome, type Project, type ProjectConfig, configFile, detectGate, laneHomeFor, loadConfig, saveConfig, serialIn } from "../project.ts";
import { type DeskServices, defineTool } from "../services.ts";
import { type Refusal, openedReply, placement, seatingKey, startLead } from "../opening.ts";
import { waitsFor } from "../waiting.ts";

/** An unreadable issue ref is a note on the lane, never a reason to refuse opening it. */
async function readIssue(args: Args, project: Project): Promise<{ issue?: Issue; unread?: string }> {
  const ref = str(args.issue);
  if (!ref) return {};
  const fetched = await fetchIssue(ref, project.root);
  return "error" in fetched ? { unread: `${ref} could not be read: ${fetched.error}` } : { issue: fetched };
}

type Place = { base: string; onBranch: boolean; branch?: string };

/** The lane as asked for, numbered in `ledger` but not yet on record there. */
function laneOf(ledger: Ledger, caller: Caller, args: Args, place: Place, issue: Issue | undefined, after?: string[]): Lane {
  const title = str(args.title);
  const id = nextLaneId(ledger);
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
    detourOf: str(args.detourOf).trim().toUpperCase() || undefined,
    onBranch: place.onBranch || undefined,
    writeSet: strs(args.writeSet),
    contracts: strs(args.contracts),
    opener: caller.id,
    status: after ? "waiting" : "open",
    after,
    // What decides how it opens, kept for when it does: the call that asked for it is long gone by then.
    opening: after && (args.isolate === true || str(args.role)) ? { isolate: args.isolate === true || undefined, role: str(args.role) || undefined } : undefined,
    openedAt: Date.now(),
    tasks: 0,
  };
}

function recordWaiting(desk: DeskServices, caller: Caller, args: Args, place: Place, issue: Issue | undefined, after: string[]): Lane {
  return desk.ctx.transact(caller.project, (ledger) => {
    const lane = laneOf(ledger, caller, args, place, issue, after);
    ledger.lanes[lane.id] = lane;
    return { ...lane };
  });
}

/** Placed where it is recorded: two lanes opened at once would otherwise both find the project's own copy free. */
function recordOpen(desk: DeskServices, caller: Caller, args: Args, place: Place, issue: Issue | undefined, serial: string[]): { lane: Lane; ownCopy: boolean } | Refusal {
  return desk.ctx.transact(caller.project, (ledger) => {
    const lane = laneOf(ledger, caller, args, place, issue);
    const placed = placement(ledger, lane, args.isolate === true, serial);
    if ("why" in placed) return placed;
    ledger.lanes[lane.id] = lane;
    desk.ctx.seating.add(seatingKey(caller.project, lane.id));
    return { lane: { ...lane }, ownCopy: placed.ownCopy };
  });
}

/** Where this lane works, as its call or the Human's standing choice says, or why the Human is asked first: only of a lane taking their copy now. */
async function homeOf(project: Project, config: ProjectConfig, asked: Args, opensNow: boolean, here: string | undefined): Promise<LaneHome | undefined | { refused: string }> {
  const said: LaneHome | undefined = asked.onBranch === true ? "onBranch" : asked.isolate === true ? "isolate" : asked.isolate === false || str(asked.base) ? "newBranch" : undefined;
  // A waiting lane opens into whatever the copy is by then, and one the copy is taken from takes a copy of its own or waits.
  if (!opensNow || ownCopyHolder(Object.values(loadLedger(project.state).lanes))) return said ?? config.laneHome;
  const home = laneHomeFor(said, config, here, await uncommittedPaths(project.root));
  if (typeof home !== "object") return home;
  return { refused: `The Human decides where this lane works, and has not said: ${home.question}. Ask them, and keep their answer for every lane with set_project laneHome if they give one.` };
}

export const openLane = defineTool({
  name: "open_lane",
  input: z.strictObject({ title: z.string().max(60), outcome: z.string(), acceptance: z.array(z.string()), appetite: z.string().optional(), deadline: z.string().optional(), outOfScope: z.array(z.string()), issue: z.string().optional(), isolate: z.boolean().optional(), base: z.string().optional(), onBranch: z.boolean().optional(), newBranch: z.string().optional(), writeSet: z.array(z.string()).optional(), contracts: z.array(z.string()).optional(), after: z.array(z.string()).optional(), detourOf: z.string().optional(), role: z.string().optional() }),
  async handle(desk, caller, asked) {
    const { project } = caller;
    const config = loadConfig(project.state);
    const after = [...new Set(strs(asked.after).map((id) => id.trim().toUpperCase()))];
    const here = await currentBranch(project.root);
    const newBranch = str(asked.newBranch).trim();
    if (newBranch && asked.onBranch !== true && config.laneHome !== "onBranch") return no("newBranch goes with onBranch: it starts the branch the lane then carries on.");
    if (asked.onBranch === true && (asked.isolate !== undefined || str(asked.base))) return no("onBranch carries on the branch the project's own copy is on, in that copy, so it takes no base and no isolate.");
    const home = await homeOf(project, config, asked, after.length === 0, here);
    if (typeof home === "object") return no(home.refused);
    const args = { ...asked, onBranch: home === "onBranch" || undefined, isolate: home === "isolate" || undefined };
    const onBranch = args.onBranch === true;
    if (onBranch && !here) return no("The project's own copy is not on a branch, so there is no branch to carry on; open the lane without onBranch to start one.");
    if (newBranch && after.length > 0) return no("A lane that waits cannot start a branch from the copy as it is now: that is not the copy it will open in. Wait without newBranch, and start the branch when its turn comes.");
    if (newBranch && (await branchExists(project.root, newBranch))) return no(`The branch ${newBranch} already exists; carry it on after switching to it, or pick another name with the Human.`);
    const pending = after.length > 0 ? waitsFor(loadLedger(project.state), after, onBranch) : [];
    if (typeof pending === "string") return no(`${pending} Open this lane without waiting for it.`);
    const carried = pending.find((lane) => lane.onBranch)?.branch;
    const base = onBranch ? carried ?? (newBranch || here!) : str(args.base) || config.base || here || "main";
    if (!newBranch && !(await branchExists(project.root, base))) return no(`The base branch ${base} does not exist.`);
    // Seeded only when unanswered: `config.gate` is "" when the owner answered "no gate". A branch carried on is not a base.
    if (!config.base || config.gate === undefined) {
      const fault = configFault(configFile(project.state));
      if (fault) return no(`${fault}\nOnly the Human can repair it or move it aside — no seat may write the desk's own files — so tell them; the desk will not write its own defaults over a file it could not read.`);
      saveConfig(project.state, { ...config, base: config.base ?? (onBranch ? undefined : base), gate: config.gate ?? detectGate(project.root, desk.ctx.kit.ecosystem) });
    }
    const place = { base, onBranch, branch: onBranch ? base : undefined };
    if (pending.length > 0) {
      const { issue } = await readIssue(args, project);
      const lane = recordWaiting(desk, caller, args, place, issue, after);
      desk.ctx.event(project, { kind: "lane.waiting", lane: lane.id, after });
      return ok(`Lane ${lane.id} waits for ${pending.map((entry) => `${entry.id} (${entry.status})`).join(", ")}. It opens by itself once they have all landed, checked again against the lanes open then; if it cannot, or one closes without landing, you get a letter. Close it to drop it.`);
    }
    const serial = await serialIn(desk.ctx.kit, project, project.root);
    // Asked before the issue is fetched, which a refusal would waste; recording the lane asks again.
    const early = placement(loadLedger(project.state), { onBranch, writeSet: strs(args.writeSet), contracts: strs(args.contracts), detourOf: str(args.detourOf).trim().toUpperCase() || undefined }, args.isolate === true, serial);
    if ("why" in early) return no(`${early.why} ${early.instead}`.trim());
    const { issue, unread } = await readIssue(args, project);
    const placed = recordOpen(desk, caller, args, place, issue, serial);
    if ("why" in placed) return no(`${placed.why} ${placed.instead}`.trim());
    const { lane } = placed;
    const started = await startLead(desk, project, lane, { ownCopy: placed.ownCopy, failed: "close", from: newBranch ? here : undefined, role: str(args.role), parent: caller.id, issue });
    if (typeof started === "string") return no(started);
    return ok(`${openedReply(project, lane, started.slot, started.lead, issue, started.elsewhere)}${unread ? `\n\nThe issue was not read into the lane: ${clip(unread, 300)}. The Lead has the outcome and the checks; give it the issue yourself if it needs one.` : ""}`);
  },
});
