import type { RoleSpec } from "../../catalog/kit/kit.ts";
import { namedOrNot, roleThatCan } from "../../catalog/kit/roles.ts";
import { fileKinds } from "../../catalog/kit/patterns.ts";
import { errorText } from "../../core/errors.ts";
import { branchExists, currentBranch, headSha } from "../../core/git.ts";
import { changedFiles } from "../../core/git-diff.ts";
import { clip } from "../../core/text.ts";
import { backlogLine, reviewBrief } from "../letters/briefs.ts";
import { workKey } from "../claims.ts";
import { type Caller, type ToolReply, no, ok, str } from "../context.ts";
import { holdRefusal } from "../lanes/hold.ts";
import { changeOf } from "../lanes/land-facts.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, backlogOf, findTask, laneOfLead, nextTaskId, tasksOf } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { seatTitle } from "../seats/names.ts";
import { type Project, riskRulesOf, rulesFor } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { handbackText } from "../store/records.ts";
import { type Same, earlierReviews, roundsLine } from "./review-handback.ts";
import { skipRefusal } from "./review-skips.ts";

/** A start_review call as the tool takes it: one task, the whole lane when `scope` is lane, else an open question on the lane. */
type ReviewCall = { task?: string; scope?: "lane"; focus: string; title?: string; role?: string };

type Change = { where: string; spec: string; sha?: string | undefined };
type Copy = { id?: string; path: string; workspaceId?: string };

/** The latest review of the same change before this one: what it found, and the change since it began. */
type Before = { id: string; file: string; range: string };

/** What a review is set up with before it is recorded: where it reads, what it reads, what it is asked, and by which role. */
type Planned = {
  lane: Lane;
  target?: Task;
  whole: boolean;
  tip?: string;
  copy: Copy;
  role: RoleSpec;
  asked: string[];
  history?: string | undefined;
  place: { where: string; range?: string; handedBack?: string; lane?: string; before?: Before; backlog?: string[] };
};

/** Starts a read-only reviewer on a task of the Lead's lane, or on the whole lane. */
export async function startReview(desk: DeskServices, caller: Caller, args: ReviewCall): Promise<ToolReply> {
  const planned = await plan(desk, caller, args);
  if (typeof planned === "string") return no(planned);
  const focus = str(args.focus);
  const review = record(desk, caller.project, planned, str(args.title), focus);
  if (typeof review === "string") return no(review);
  return seat(desk, caller, planned, review, focus);
}

async function plan(desk: DeskServices, caller: Caller, args: ReviewCall): Promise<Planned | string> {
  const { project } = caller;
  const ledger = loadLedger(project.state);
  const lane = laneOfLead(ledger, caller.id);
  if (!lane?.worktree) return "You have no open lane.";
  const held = holdRefusal(lane);
  if (held) return held;
  const named = str(args.task);
  const whole = args.scope === "lane";
  if (named && whole)
    return "Name a task for a review of it, or scope lane for the review of the whole lane, not both.";
  const target = named ? findTask(ledger, named) : undefined;
  if (named && (!target || target.lane !== lane.id || target.kind !== "code"))
    return `${named} is not a code task in your lane.`;
  const { laneCopy, own } = copiesFor(ledger, lane, lane.worktree, target);
  const change = target ? await rangeOf(project, target, lane, own) : undefined;
  if (target && !change)
    return `${target.id} worked in a copy that has been given back, and neither a merge nor a branch is left to read it from. Ask for a review of the lane instead.`;
  const copy = own ?? laneCopy;
  if (!copy) return "The working copy for that review is gone.";
  // No fallback to a plain worker: read-only comes from the reviewer role's settings, so a stand-in could rewrite.
  const lens = str(args.role);
  const role = roleThatCan(desk.kit, "review", lens || undefined);
  if (!role) return namedOrNot(desk.kit, "review", lens, "review, so there is nobody to ask a read-only question of");
  const files = change ? await changedFiles(copy.path, change.spec) : (await changeOf(project, lane)).files;
  const skipped =
    target && skipRefusal(desk.teamFor(project).roles[role.role], ledger, target, files, fileKinds(desk.kit));
  if (skipped) return skipped;
  const asked = askedOf(desk, project, files);
  const same: Same = { id: "", lane: lane.id, ...(whole ? { scope: "lane" as const } : {}), of: target?.id };
  const tip = whole ? await headSha(project.root, lane.branch) : change?.sha;
  const place =
    target && change
      ? {
          where: change.where,
          range: `git diff ${change.spec}`,
          ...(target.handback ? { handedBack: handbackText(target.handback.file) } : {}),
          ...(tip && target.status !== "merged" ? beforeOf(ledger, same, tip) : {}),
        }
      : { where: await laneView(ledger, lane, copy.path), ...(whole ? await wholeRange(project, lane, ledger) : {}) };
  return { lane, target, whole, tip, copy, role, asked, history: roundsLine(ledger, same), place };
}

/** The latest earlier review of the same change that kept where it began: its findings, and what changed since, up to `to`. */
function beforeOf(ledger: Ledger, same: Same, to: string): { before?: Before } {
  const last = earlierReviews(ledger, same)
    .filter((review) => review.startSha)
    .at(-1);
  return last ? { before: { id: last.id, file: last.handback.file, range: `git diff ${last.startSha!}..${to}` } } : {};
}

/** A review is a task of the lane that holds nothing, recorded running and claimed; the lane is read again, as it may have closed or been held meanwhile. */
function record(
  { ledgers, seating }: Pick<DeskServices, "ledgers" | "seating">,
  project: Project,
  planned: Planned,
  title: string,
  focus: string,
): Task | string {
  const { lane, target, whole, tip, copy, asked } = planned;
  return ledgers.transact(project, (current): Task | string => {
    const now = current.lanes[lane.id];
    if (now?.status !== "open") return `Lane ${lane.id} closed while its review was being set up.`;
    const held = holdRefusal(now);
    if (held) return held;
    const id = nextTaskId(now, "review");
    const at = Date.now();
    const created: Task = {
      id,
      lane: lane.id,
      kind: "review",
      mode: "lane",
      of: target?.id,
      ...(whole ? { scope: "lane" as const } : {}),
      asked: asked.length > 0 ? asked : undefined,
      title: title || (target ? `Review ${target.id}` : clip(focus.split(/\r?\n/)[0] ?? "Review", 50)),
      goal: focus,
      acceptance: target?.acceptance ?? (whole ? lane.acceptance : []),
      hints: [],
      holds: [],
      outOfScope: [],
      context: lane.branch,
      worktree: copy.path,
      slot: copy.id,
      ...(tip ? { startSha: tip } : {}),
      status: "running",
      openedAt: at,
      updatedAt: at,
      silent: 0,
    };
    current.tasks[id] = created;
    seating.take(workKey(project, id));
    return { ...created };
  });
}

/** Seats the reviewer; one that cannot start leaves the review cut. */
async function seat(
  desk: DeskServices,
  caller: Caller,
  planned: Planned,
  review: Task,
  focus: string,
): Promise<ToolReply> {
  const { ledgers, agents, seating } = desk;
  const { project } = caller;
  const { lane, target, role } = planned;
  try {
    const reviewer = await agents.start(project, planned.copy, role.role, {
      parent: caller.id,
      title: seatTitle.review(review.id, target?.id ?? lane.id),
      prompt: reviewBrief(review, target, focus, planned.place),
      labels: { "crew.lane": lane.id, "crew.task": review.id, "crew.role": role.role },
    });
    ledgers.transact(project, (current) => {
      const entry = current.tasks[review.id];
      if (entry) Object.assign(entry, { peer: reviewer, updatedAt: Date.now() });
      current.agents[reviewer] = { id: reviewer, role: role.role, lane: lane.id, task: review.id };
    });
    recordEvent(project, { kind: "review.started", task: review.id, of: target?.id ?? null, reviewer });
    const on = target ? ` on ${target.id}` : planned.whole ? " on the whole lane" : "";
    const history = planned.history ? ` ${planned.history}` : "";
    return ok(`Started ${review.id}${on} with reviewer ${reviewer}.${history} The verdict arrives as mail.`);
  } catch (error) {
    ledgers.moveTask(project, review.id, "cut");
    return no(`The reviewer could not start: ${errorText(error)}`);
  } finally {
    seating.release(workKey(project, review.id));
  }
}

/**
 * Where the change to review is read from: the copy its branch is checked out in until it merges, up to its last hand-back,
 * and the merge after that. Read from where its branch meets the lane's, what came in with the lane is not the task's.
 */
async function rangeOf(project: Project, target: Task, lane: Lane, own: Copy | undefined): Promise<Change | undefined> {
  const tip = target.status === "running" || target.status === "rework" ? "HEAD" : (target.handback?.commit ?? "HEAD");
  if (own)
    return {
      where: "Your working copy holds the change",
      spec: `${lane.branch}...${tip}`,
      sha: await headSha(own.path, tip),
    };
  if (target.mergeSha)
    return {
      where: `The change is in ${lane.branch}, as the merge ${target.mergeSha.slice(0, 7)}`,
      spec: `${target.mergeSha}^1..${target.mergeSha}`,
      sha: target.mergeSha,
    };
  if (target.branch && (await branchExists(project.root, target.branch)))
    return {
      where: `The change is on ${target.branch}, not in your working copy`,
      spec: `${lane.branch}...${target.branch}`,
      sha: await headSha(project.root, target.branch),
    };
  return undefined;
}

/** The review of the whole lane reads the lane's change from where it began, and after an earlier one, what changed since. */
async function wholeRange(
  project: Project,
  lane: Lane,
  ledger: Ledger,
): Promise<{ lane: string; range?: string; before?: Before; backlog: string[] }> {
  const { from } = await changeOf(project, lane);
  return {
    lane: lane.title,
    ...(from ? { range: `git diff ${from}..${lane.branch}` } : {}),
    ...beforeOf(ledger, { id: "", lane: lane.id, scope: "lane" }, lane.branch),
    backlog: backlogOf(ledger, lane.id).map(({ review, finding }) => backlogLine(review, finding)),
  };
}

/** Where a review on the lane reads it: the lane branch, which a task at work in the lane's copy has off its own. */
async function laneView(ledger: Ledger, lane: Lane, copy: string): Promise<string> {
  const on = await currentBranch(copy);
  if (on === lane.branch) return `Your working copy is on ${lane.branch}.`;
  const holder = tasksOf(ledger, lane.id).find((task) => task.branch === on);
  const at = holder ? `, where ${holder.id} is at work` : "";
  return `Your working copy is on ${on ?? "no branch"}${at}, not ${lane.branch}: read ${lane.branch} itself with git (git show ${lane.branch}:<path>, git log ${lane.branch}).`;
}

/** The questions of every risk rule the reviewed change reaches; a change git cannot read is asked them all. */
function askedOf({ kit }: Pick<DeskServices, "kit">, project: Project, files: string[] | undefined): string[] {
  const rules = riskRulesOf(project, kit);
  return [...new Set((files ? rulesFor(rules, files) : rules).map((rule) => rule.reviewQuestion))];
}

/** The lane's copy, and the one `target` still has its branch checked out in: its own beside others, else the lane's. */
function copiesFor(
  ledger: Ledger,
  lane: Lane,
  worktree: string,
  target: Task | undefined,
): { laneCopy?: Copy; own?: Copy } {
  const laneCopy: Copy | undefined = lane.slot
    ? ledger.slots[lane.slot]
    : { path: worktree, workspaceId: lane.workspaceId };
  // A slot marked for teardown still answers as the task's copy; a reviewer seated there loses it at the Peer's turn end.
  const holds = target?.slot ? ledger.slots[target.slot] : undefined;
  const beside = target?.mode === "parallel" && holds?.task === target.id && !holds.releasing ? holds : undefined;
  // Until it merges its branch is checked out in its copy, the lane's for a task there; merged, it is read from the lane's copy.
  const own = target && target.status !== "merged" ? (target.mode === "parallel" ? beside : laneCopy) : undefined;
  return { laneCopy, own };
}
