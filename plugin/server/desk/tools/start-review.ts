import { z } from "zod";
import { namedOrNot, roleThatCan } from "../../catalog/kit.ts";
import { branchExists, changedFiles, mergesIn, ownChangedFiles } from "../../core/git.ts";
import { type DeskContext, no, ok, str } from "../context.ts";
import { errorText } from "../../core/errors.ts";
import { type Lane, type Task, findTask, laneOfLead, loadLedger, nextTaskId } from "../ledger.ts";
import { clip } from "../../core/text.ts";
import { reviewBrief } from "../briefs.ts";
import { changeOf } from "../landing.ts";
import { newReviewer } from "../names.ts";
import { seatingKey } from "../opening.ts";
import { type Project, riskRulesOf, rulesFor } from "../project.ts";
import { type DeskServices, defineTool } from "../services.ts";

type Change = { where: string; spec: string; own?: { from: string; to: string } };

/**
 * Where the change to review is read from. A landed parallel task's copy and branch are gone, so it is read from the merge; a task in
 * the lane's copy from its own commits up to its last hand-back, since tasks beside it may be merged into that copy and others follow.
 */
async function rangeOf(project: Project, target: Task, lane: Lane, inOwnCopy: boolean): Promise<Change | undefined> {
  if (target.mode !== "parallel") {
    const from = target.startSha ?? lane.branch;
    const to = target.status === "running" || target.status === "rework" ? "HEAD" : (target.handback?.commit ?? "HEAD");
    return { where: "Your working copy holds the change", spec: `${from}..${to}`, own: { from, to } };
  }
  if (inOwnCopy) return { where: "Your working copy holds the change", spec: `${lane.branch}...HEAD` };
  if (target.mergeSha) return { where: `The change is in ${lane.branch}, as the merge ${target.mergeSha.slice(0, 7)}`, spec: `${target.mergeSha}^1..${target.mergeSha}` };
  if (target.branch && (await branchExists(project.root, target.branch))) return { where: `The change is on ${target.branch}, not in your working copy`, spec: `${lane.branch}...${target.branch}` };
  return undefined;
}

/** The questions of every risk rule the reviewed change reaches; a change git cannot read is asked them all. */
async function askedOf(desk: DeskServices, project: Project, lane: Lane, copy: string, change: Change | undefined): Promise<string[]> {
  const rules = riskRulesOf(project, desk.ctx.kit);
  const files = change ? await (change.own ? ownChangedFiles(copy, change.own.from, change.own.to) : changedFiles(copy, change.spec)) : (await changeOf(project, lane)).files;
  return [...new Set((files ? rulesFor(rules, files) : rules).map((rule) => rule.reviewQuestion))];
}

/** A review is a task of the lane that owns nothing, recorded running and marked seating like any other. */
function recordReview(ctx: DeskContext, project: Project, lane: Lane, target: Task | undefined, title: string, focus: string, slot: { id?: string; path: string }, asked: string[]): Task {
  return ctx.transact(project, (current) => {
    const id = nextTaskId(current.lanes[lane.id]!, "review");
    const now = Date.now();
    const created: Task = {
      id,
      lane: lane.id,
      kind: "review",
      mode: "lane",
      of: target?.id,
      asked: asked.length > 0 ? asked : undefined,
      title: title || (target ? `Review ${target.id}` : clip(focus.split(/\r?\n/)[0] ?? "Review", 50)),
      goal: focus,
      acceptance: target?.acceptance ?? [],
      owned: [],
      outOfScope: [],
      context: lane.branch,
      worktree: slot.path,
      slot: slot.id,
      status: "running",
      openedAt: now,
      updatedAt: now,
      silent: 0,
    };
    current.tasks[id] = created;
    ctx.seating.add(seatingKey(project, id));
    return { ...created };
  });
}

export const startReview = defineTool({
  name: "start_review",
  input: z.strictObject({ task: z.string().optional(), focus: z.string(), title: z.string().max(60).optional(), role: z.string().optional() }),
  async handle(desk, caller, args) {
    const { ctx, agents } = desk;
    const { project } = caller;
    const focus = str(args.focus);
    const ledger = loadLedger(project.state);
    const lane = laneOfLead(ledger, caller.id);
    if (!lane?.worktree) return no("You have no open lane.");
    const target = str(args.task) ? findTask(ledger, str(args.task)) : undefined;
    if (str(args.task) && (!target || target.lane !== lane.id || target.kind !== "code")) return no(`${str(args.task)} is not a code task in your lane.`);
    // A slot marked for teardown still answers as the task's copy; a reviewer seated there loses it at the Peer's turn end.
    const holds = target?.slot ? ledger.slots[target.slot] : undefined;
    const own = target?.mode === "parallel" && holds?.task === target.id && !holds.releasing ? holds : undefined;
    const change = target ? await rangeOf(project, target, lane, Boolean(own)) : undefined;
    if (target && !change)
      return no(`${target.id} worked in a copy that has been given back, and neither a merge nor a branch is left to read it from. Ask for a review of the lane instead.`);
    const slot: { id?: string; path: string; workspaceId?: string } | undefined =
      own ?? (lane.slot ? ledger.slots[lane.slot] : { path: lane.worktree, workspaceId: lane.workspaceId });
    if (!slot) return no("The working copy for that review is gone.");
    // No fallback to a plain worker: read-only comes from the reviewer role's settings, so a stand-in could rewrite.
    const lens = str(args.role);
    const reviewRole = roleThatCan(ctx.kit, "review", lens || undefined);
    if (!reviewRole) return no(namedOrNot(ctx.kit, "review", lens, "review, so there is nobody to ask a read-only question of"));
    const asked = await askedOf(desk, project, lane, slot.path, change);
    // git diff cannot leave a merge out, so a range the desk merged a task beside into is read commit by commit.
    const read = change?.own && (await mergesIn(slot.path, change.own.from, change.own.to)) ? `git log -p --first-parent --no-merges ${change.spec}` : `git diff ${change?.spec}`;
    const review = recordReview(ctx, project, lane, target, str(args.title), focus, slot, asked);
    try {
      const named = newReviewer(loadLedger(project.state), lane, target?.id ?? lane.id);
      const reviewer = await agents.start(project, slot, reviewRole.role, {
        parent: caller.id,
        title: named.title,
        prompt: reviewBrief(review, target, focus, lane.branch, change && { where: change.where, range: read }),
        labels: { "seatworks.lane": lane.id, "seatworks.team": named.team, "seatworks.task": review.id, "seatworks.role": reviewRole.role },
      });
      ctx.setTask(project, review.id, (entry) => {
        entry.peer = reviewer;
      });
      ctx.transact(project, (current) => {
        current.agents[reviewer] = { id: reviewer, role: reviewRole.role, lane: lane.id, task: review.id, team: named.team };
      });
      ctx.event(project, { kind: "review.started", task: review.id, of: target?.id ?? null, reviewer });
      return ok(`Started ${review.id}${target ? ` on ${target.id}` : ""} with reviewer ${reviewer}. The verdict arrives as mail.`);
    } catch (error) {
      ctx.moveTask(project, review.id, "cut");
      return no(`The reviewer could not start: ${errorText(error)}`);
    } finally {
      ctx.seating.delete(seatingKey(project, review.id));
    }
  },
});
