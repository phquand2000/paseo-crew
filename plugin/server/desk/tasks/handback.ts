import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Kit } from "../../catalog/kit/kit.ts";
import { changedFiles, diffCounts } from "../../core/git-diff.ts";
import { fileKinds } from "../../catalog/kit/patterns.ts";
import { currentBranch, headSha, pristineState } from "../../core/git.ts";
import { capped, clip } from "../../core/text.ts";
import { IN_QUEUE, SETTLED, TASK, type TaskStatus } from "../../domain/task.ts";
import { handbackCase } from "../watch/checks.ts";
import { type Caller, type ToolReply, no, ok } from "../context.ts";
import { taskGate } from "../project/gates.ts";
import { judge } from "../watch/judging.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, taskOfPeer } from "../../domain/ledger.ts";
import type { ReviewFinding, Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { type Rounds, workLetters } from "../letters/work-letters.ts";
import { type Project, gitTimeout, serialIn } from "../project/project.ts";
import { changeFrom } from "./change-from.ts";
import { type Verdict, reviewBody, roundsLine, roundsOf, verdictRefusal } from "./review-handback.ts";
import { reachNotes } from "./reach.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { type Synced, bringLaneIn } from "../copies/sync.ts";

/** A hand-back as the done tool takes it: a task's outcome and summary, or a review's verdict and findings. */
type HandingBack = Verdict & {
  outcome?: string;
  summary?: string;
  checks?: string;
  leftUndone?: string;
  discovered?: string;
};

type Lines = { src: number; test: number };

/** What a code task's copy holds as it hands back, as git says it. */
type Work = {
  commit?: string;
  uncommitted: boolean;
  synced?: string;
  changed?: string[];
  lines?: Lines;
  notes: string[];
};

/** The hand-back as written: its file, what it says, and the gate run on it. */
type Written = {
  file: string;
  outcome: string;
  body: string;
  gate?: { ok: boolean; note: string };
  findings?: ReviewFinding[];
};

const SHOWN_CHANGED = 20;

/** One hand-back for tasks and reviews: the task's kind says which of the two a seat sent. */
export async function handBack(desk: DeskServices, caller: Caller, args: HandingBack): Promise<ToolReply> {
  const { project } = caller;
  const ledger = loadLedger(project.state);
  const task = taskOfPeer(ledger, caller.id);
  if (!task) return no("No task is assigned to you.");
  const refused = refusal(task, args);
  if (refused) return no(refused);
  const lane = ledger.lanes[task.lane];
  const synced = await syncOf(project, task, lane);
  if (synced && "conflicts" in synced) return settling(desk, task, lane!, synced);
  const work = await workOf(desk.kit, project, ledger, task, synced);
  const written = await write(desk, project, task, args, work);
  const summary = (task.kind === "review" ? args.answer : args.summary)?.trim() ?? "";
  // Read where it is written: a message sent now cuts into this call's turn, and the hand-back must not outrun it.
  if (desk.mail.heededSince(caller.id, caller.at))
    return no(
      "done was not carried out: mail that changes your work came while it ran. Weigh it, then call done again if it still stands.",
    );
  const already = record(desk, project, task, written, work.commit, summary);
  if (already) {
    const queued = already !== "gone" && IN_QUEUE.includes(already);
    return no(
      queued
        ? `${task.id} is already accepted and waiting to be merged; handing it back again would take it out of the queue. End your turn.`
        : `${task.id} is already ${already}; there is nothing to hand back.`,
    );
  }
  const rounds = task.kind === "review" ? roundsAt(desk, project, ledger, task, written.outcome) : undefined;
  await tell(desk, caller, task, lane, { ...written, summary, commit: work.commit, lines: work.lines, rounds });
  const reminder = task.kind === "review" ? "" : await reminderOf(task, work.uncommitted);
  return ok(`Handed back.${reminder} End your turn now; if anything changes you will get a message.`);
}

/** A review's place in the rounds on its change, against the count the project's settings stop them at. */
function roundsAt(desk: DeskServices, project: Project, ledger: Ledger, task: Task, outcome: string): Rounds {
  const { reviewRoundsAt } = desk.teamFor(project).attention;
  return { count: roundsOf(ledger, task, outcome), at: reviewRoundsAt, history: roundsLine(ledger, task) };
}

/** Why this hand-back is refused before anything is read: a settled task, or a review's verdict the desk cannot carry. */
function refusal(task: Task, args: HandingBack): string | undefined {
  if (SETTLED.includes(task.status)) return `This task is already ${task.status}; there is nothing to hand back.`;
  return task.kind === "review" ? verdictRefusal(task, args) : undefined;
}

/** A task hands back what its lane would become: the lane comes into its copy first. */
function syncOf(project: Project, task: Task, lane: Lane | undefined): Promise<Synced | undefined> {
  if (task.kind !== "code" || !lane || !task.worktree || !task.branch) return Promise.resolve(undefined);
  return bringLaneIn({ ...task, worktree: task.worktree, branch: task.branch }, lane, gitTimeout(project));
}

/** Bringing the lane in stopped on conflicts: the Peer settles them before it hands back, and its Lead is told in passing. */
async function settling(
  { mail }: Pick<DeskServices, "mail">,
  task: Task,
  lane: Lane,
  synced: { conflicts: string[]; by: string[] },
): Promise<ToolReply> {
  await mail.post(lane.lead, workLetters.settling(task, lane.branch, synced.conflicts, synced.by));
  const by = synced.by.length > 0 ? `, changed there by ${synced.by.join(", ")}` : "";
  return no(
    `Not handed back yet: ${lane.branch} has moved on since your branch left it, and bringing it in conflicts in ${synced.conflicts.join(", ")}${by}. The merge is left in your copy: settle it so both changes stand, commit it with git commit --no-edit (an editor would wait forever here), then call done again.`,
  );
}

/** What a code task's copy holds: its commit, work left uncommitted, the files it changed, and what of those to weigh. */
async function workOf(kit: Kit, project: Project, ledger: Ledger, task: Task, synced?: Synced): Promise<Work> {
  if (task.kind === "review" || !task.worktree) return { uncommitted: false, notes: [] };
  const lane = ledger.lanes[task.lane];
  const line =
    !synced || !lane
      ? undefined
      : "at" in synced
        ? `Brought up to date with ${lane.branch} at ${synced.at.slice(0, 7)}.`
        : "not" in synced
          ? `Not brought up to date with ${lane.branch}: ${synced.not}.`
          : undefined;
  const from = lane ? await changeFrom(task.worktree, task, lane.branch, "HEAD") : undefined;
  const changed = from ? await changedFiles(task.worktree, `${from}..HEAD`) : undefined;
  const counts = from ? await diffCounts(task.worktree, from, "HEAD", fileKinds(kit)) : undefined;
  const serial = lane && changed && task.mode === "parallel" ? await serialIn(kit, project, task.worktree) : [];
  const notes = lane && changed ? reachNotes(ledger, task, lane, changed, serial) : [];
  // Only what git actually said: a copy it could not read is not a copy with work left in it.
  const commit = await headSha(task.worktree);
  const uncommitted = (await pristineState(task.worktree)) === "dirty";
  const lines = counts && { src: counts.src, test: counts.test };
  return { commit, uncommitted, synced: line, changed, ...(lines ? { lines } : {}), notes };
}

/** Gated at hand-back so the Lead has the verdict in time; gating after accept undid a merge already chosen. */
async function write(
  desk: Pick<DeskServices, "kit" | "stopping" | "gating">,
  project: Project,
  task: Task,
  args: HandingBack,
  work: Work,
): Promise<Written> {
  const { outcome, body } = task.kind === "review" ? reviewBody(task, args) : taskBody(args, work);
  const run =
    task.kind !== "review" && task.worktree
      ? await taskGate(desk, project, task, task.worktree, work.changed)
      : undefined;
  const red =
    run &&
    `${run.note}. The lane takes it red only if you accept it over the gate with a reason.\n\n${run.tail}\n\nFull log: ${run.logFile}`;
  const gated = run ? `${body}\n\nGate: ${run.ok ? run.note : red}` : body;
  const file = join(project.state, "handbacks", `${task.id}-${Date.now()}.md`);
  mkdirSync(join(project.state, "handbacks"), { recursive: true });
  writeFileSync(file, `# ${task.id} ${task.title}\n\n${gated}\n`);
  const findings = task.kind === "review" && args.findings?.length ? { findings: args.findings } : {};
  return { file, outcome, body: gated, ...(run ? { gate: { ok: run.ok, note: run.note } } : {}), ...findings };
}

function taskBody(
  args: HandingBack,
  { commit, uncommitted, synced, changed, lines: counted, notes }: Work,
): { outcome: string; body: string } {
  const outcome = args.outcome?.trim() ?? "";
  const lines = [
    `Outcome: ${outcome}`,
    `Commit: ${commit ?? "none"}${uncommitted ? " (the working copy still has uncommitted changes)" : ""}`,
    ...(synced ? [synced] : []),
    "",
    args.summary?.trim() || "No summary given.",
    "",
    `Checks: ${args.checks?.trim() || "not given"}`,
    `Left undone: ${args.leftUndone?.trim() || "nothing"}`,
    `Discovered: ${args.discovered?.trim() || "nothing"}`,
    ...(changed ? [`Changed: ${changed.length > 0 ? capped(changed, SHOWN_CHANGED) : "no files"}`] : []),
    ...(counted ? [`Lines changed: source ${counted.src}, tests ${counted.test}.`] : []),
    ...notes.map((note) => `Note: ${note}.`),
  ];
  return { outcome, body: lines.join("\n") };
}

/** Decided under the lock: an accept or cut can land during the gate, and `done` over `queued` made the merge queue skip it. */
function record(
  { ledgers }: Pick<DeskServices, "ledgers">,
  project: Project,
  task: Task,
  written: Written,
  commit: string | undefined,
  summary: string,
): TaskStatus | "gone" | undefined {
  return ledgers.transact(project, (current) => {
    const entry = current.tasks[task.id];
    if (!entry) return "gone";
    if (!TASK.move(entry, "handBack")) return entry.status;
    entry.silent = 0;
    // Handed back, it waits for nothing its Lead held it for: what comes next is the Lead's call.
    delete entry.held;
    const gate = written.gate ? { gate: { ...written.gate, sha: commit } } : {};
    entry.handback = {
      file: written.file,
      outcome: written.outcome,
      commit,
      summary: clip(summary, 400),
      at: Date.now(),
      ...gate,
      ...(written.findings ? { findings: written.findings } : {}),
    };
    return undefined;
  });
}

/** Whoever reads the hand-back is told and it goes on record; the watch's questions about it are asked, and not waited for. */
async function tell(
  desk: DeskServices,
  caller: Caller,
  task: Task,
  lane: Lane | undefined,
  handed: Written & { summary: string; commit?: string; lines?: Lines | undefined; rounds: Rounds | undefined },
): Promise<void> {
  const { kit, mail, roster } = desk;
  const heading =
    task.kind === "review" ? { ...task, title: task.of ? `review of ${task.of}` : `review: ${task.title}` } : task;
  const reader = await roster.readerOf(caller.project, lane);
  await mail.post(reader.to, workLetters.handback(heading, handed.body, caller.id, reader.as, handed.rounds));
  const done = { task: task.id, outcome: handed.outcome, commit: handed.commit };
  recordEvent(
    caller.project,
    task.kind === "review"
      ? { kind: "review.done", ...done, of: task.of ?? null, role: caller.role.role }
      : { kind: "task.done", ...done, lines: handed.lines ?? null },
  );
  const judged = handbackCase(kit, caller.project, task, handed);
  if (judged) void judge(desk, caller.project, judged);
}

/** What the Peer must fix before its turn ends: work left uncommitted, or a copy off its branch, where a commit belongs to no branch. */
async function reminderOf(task: Task, uncommitted: boolean): Promise<string> {
  const meant = task.branch;
  const adrift = meant && task.worktree ? (await currentBranch(task.worktree)) !== meant : false;
  if (uncommitted) return " Your working copy still has uncommitted changes: commit them before ending your turn.";
  if (!adrift) return "";
  return ` Your working copy is not on ${meant} any more, so anything you committed is on no branch and will be collected. After a bisect, git bisect reset takes it back to ${meant}: commit there before your turn ends. If you left it some other way, say so with ask: moving a copy between branches is the desk's.`;
}
