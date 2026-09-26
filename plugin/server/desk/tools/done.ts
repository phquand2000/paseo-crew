import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { changedFiles, currentBranch, headSha, outsideOwned, ownChangedFiles, pristineState } from "../../core/git.ts";
import { IN_QUEUE, SETTLED, TASK } from "../../domain/task.ts";
import { type Args, type Caller, type ToolReply, no, ok, str, strs } from "../context.ts";
import { handbackCase } from "../checks.ts";
import { taskGate } from "../gates.ts";
import { judge } from "../judging.ts";
import { type Lane, type Task, loadLedger, taskOfPeer } from "../ledger.ts";
import { clip } from "../../core/text.ts";
import { letters } from "../letters.ts";
import { type DeskServices, defineTool } from "../services.ts";

type Work = { commit?: string; uncommitted: boolean; outside: string[] };

/** What a code task's copy holds as it hands back, as git says: its commit, work left uncommitted, and files changed outside its owned paths. */
async function workOf(task: Task, lane: Lane | undefined): Promise<Work> {
  if (task.kind === "review" || !task.worktree) return { uncommitted: false, outside: [] };
  // A task in the lane's copy counts its own commits only: a task beside it may have been merged into that copy meanwhile.
  const changed = task.mode === "parallel" ? (lane ? await changedFiles(task.worktree, `${lane.branch}...HEAD`) : undefined) : task.startSha ? await ownChangedFiles(task.worktree, task.startSha) : undefined;
  // Only what git actually said: a copy it could not read is not a copy with work left in it.
  return { commit: await headSha(task.worktree), uncommitted: (await pristineState(task.worktree)) === "dirty", outside: outsideOwned(changed ?? [], task.owned) };
}

function handbackBody(task: Task, args: Args, { commit, uncommitted, outside }: Work): { outcome: string; body: string } {
  if (task.kind === "review") {
    const outcome = str(args.verdict);
    const findings = ((args.findings ?? []) as Finding[]).map((found) => `- ${found.severity} ${found.where}: ${found.failure} Fix: ${found.fix}${found.confirmedBy ? ` Confirmed by: ${found.confirmedBy}` : ""}`);
    const answers = strs(args.answers);
    const asked = (task.asked ?? []).flatMap((question, index) => [`${index + 1}. ${question}`, `   ${answers[index]}`]);
    const lines = [`Verdict: ${outcome}`, "", str(args.answer), "", "Findings:", ...(findings.length > 0 ? findings : ["none"]), ...(asked.length > 0 ? ["", "Asked by the project's risk rules:", ...asked] : []), "", `Read: ${strs(args.read).join("; ") || "not given"}`, `Ran: ${strs(args.ran).join("; ") || "nothing"}`];
    return { outcome, body: lines.join("\n") };
  }
  const outcome = str(args.outcome);
  const lines = [
    `Outcome: ${outcome}`,
    `Commit: ${commit ?? "none"}${uncommitted ? " (the working copy still has uncommitted changes)" : ""}`,
    "",
    str(args.summary) || "No summary given.",
    "",
    `Checks: ${str(args.checks) || "not given"}`,
    `Left undone: ${str(args.leftUndone) || "nothing"}`,
    `Discovered: ${str(args.discovered) || "nothing"}`,
    ...(outside.length > 0 ? [`Changed outside its owned paths: ${outside.join(", ")}`] : []),
  ];
  return { outcome, body: lines.join("\n") };
}

const HandBack = z.strictObject({ outcome: z.enum(["complete", "partial", "blocked"]), summary: z.string(), checks: z.string().optional(), leftUndone: z.string().optional(), discovered: z.string().optional() });

const Finding = z.strictObject({ severity: z.enum(["P0", "P1", "P2", "P3"]), where: z.string(), failure: z.string(), fix: z.string(), confirmedBy: z.string().optional() });
type Finding = z.infer<typeof Finding>;

const Verdict = z.strictObject({ verdict: z.enum(["accept", "changes", "reopen"]), answer: z.string(), answers: z.array(z.string()).optional(), findings: z.array(Finding).optional(), read: z.array(z.string()).optional(), ran: z.array(z.string()).optional() });

/** What the Peer must fix before its turn ends: work left uncommitted, or a copy off the branch, where a commit belongs to no branch and goes with the copy. */
async function reminderOf(task: Task, laneBranch: string | undefined, uncommitted: boolean): Promise<string> {
  const meant = task.mode === "parallel" ? task.branch : laneBranch;
  const adrift = meant && task.worktree ? (await currentBranch(task.worktree)) !== meant : false;
  if (uncommitted) return " Your working copy still has uncommitted changes: commit them before ending your turn.";
  return adrift ? ` Your working copy is not on ${meant} any more, so anything you committed is on no branch and will be collected. After a bisect, git bisect reset takes it back to ${meant}: commit there before your turn ends. If you left it some other way, say so with ask: moving a copy between branches is the desk's.` : "";
}

/** A Lead no longer seated would never read a hand-back; the level above is told instead and can seat one. */
async function readerOf(roster: DeskServices["roster"], project: Caller["project"], lane: Lane | undefined): Promise<{ to: string | undefined; as: "lead" | "supervisor" }> {
  if (lane?.lead && (await roster.seated(lane.lead))) return { to: lane.lead, as: "lead" };
  return { to: await roster.supervisorFor(project, lane?.opener), as: "supervisor" };
}

/** Whoever reads the hand-back is told and it goes on record; the watch's questions about it are asked, and not waited for. */
async function tell(services: DeskServices, caller: Caller, task: Task, lane: Lane | undefined, handed: { file: string; outcome: string; body: string; summary: string; commit?: string }): Promise<void> {
  const { ctx, roster } = services;
  const heading = task.kind === "review" ? { ...task, title: task.of ? `review of ${task.of}` : `review: ${task.title}` } : task;
  const reader = await readerOf(roster, caller.project, lane);
  await ctx.post(reader.to, letters.handback(heading, handed.file, handed.body, caller.id, reader.as));
  ctx.event(caller.project, { kind: task.kind === "review" ? "review.done" : "task.done", task: task.id, outcome: handed.outcome, commit: handed.commit });
  const judged = handbackCase(ctx.kit, caller.project, task, handed);
  if (judged) void judge(services, caller.project, judged);
}

/** One hand-back for tasks and reviews: the task's kind says which of the two a seat sent. */
async function handBack(services: DeskServices, caller: Caller, args: Partial<z.infer<typeof HandBack> & z.infer<typeof Verdict>>): Promise<ToolReply> {
  const { ctx } = services;
  const { project } = caller;
  const ledger = loadLedger(project.state);
  const task = taskOfPeer(ledger, caller.id);
  if (!task) return no("No task is assigned to you.");
  if (SETTLED.includes(task.status)) return no(`This task is already ${task.status === "merged" ? "accepted" : "cut"}; there is nothing to hand back.`);
  const review = task.kind === "review";
  if (review && args.verdict !== "accept" && (args.findings ?? []).length === 0) return no(`A verdict of ${args.verdict} names what must change: give each finding.`);
  const asked = task.asked ?? [];
  if (review && asked.some((_, index) => !args.answers?.[index]?.trim())) {
    return no(`The project's risk rules ask this review ${asked.length === 1 ? "a question" : `${asked.length} questions`}; give answers, one per question, in this order:\n${asked.map((question, index) => `${index + 1}. ${question}`).join("\n")}`);
  }
  const work = await workOf(task, ledger.lanes[task.lane]);
  const { commit } = work;
  const handed = handbackBody(task, args, work);
  const { outcome } = handed;
  // Gated at hand-back so the Lead has the verdict in time; gating after accept undid a merge already chosen.
  const run = !review && task.worktree ? await taskGate(project, task.id, task.worktree) : undefined;
  const body = run
    ? `${handed.body}\n\nGate: ${run.ok ? run.note : `${run.note}. This is evidence for your decision, not a decision.\n\n${run.tail}\n\nFull log: ${run.logFile}`}`
    : handed.body;
  const file = join(project.state, "handbacks", `${task.id}-${Date.now()}.md`);
  mkdirSync(join(project.state, "handbacks"), { recursive: true });
  writeFileSync(file, `# ${task.id} ${task.title}\n\n${body}\n`);
  // Decided under the lock: an accept or cut can land during the gate, and `done` over `queued` made the merge queue skip it.
  const already = ctx.transact(project, (current) => {
    const entry = current.tasks[task.id];
    if (!entry) return "gone";
    if (!TASK.move(entry, "handBack")) return entry.status;
    entry.silent = 0;
    entry.handback = { file, outcome, commit, summary: clip(str(review ? args.answer : args.summary), 400), at: Date.now(), ...(run ? { gate: { ok: run.ok, note: run.note } } : {}) };
    return undefined;
  });
  if (already) {
    return no(
      already !== "gone" && IN_QUEUE.includes(already)
        ? `${task.id} is already accepted and waiting to be merged; handing it back again would take it out of the queue. End your turn.`
        : `${task.id} is already ${already === "merged" ? "accepted" : already}; there is nothing to hand back.`,
    );
  }
  await tell(services, caller, task, ledger.lanes[task.lane], { file, outcome, body, summary: str(review ? args.answer : args.summary), commit });
  const reminder = review ? "" : await reminderOf(task, ledger.lanes[task.lane]?.branch, work.uncommitted);
  const outside = work.outside.length > 0 ? ` You changed ${work.outside.join(", ")} outside your owned paths; your Lead sees that with the hand-back.` : "";
  return ok(`Handed back.${outside}${reminder} End your turn now; if anything changes you will get a message.`);
}

export const done = defineTool({ name: "done", input: HandBack, handle: handBack });

export const doneReview = defineTool({ name: "done", input: Verdict, handle: handBack });
