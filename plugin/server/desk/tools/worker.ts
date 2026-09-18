import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentBranch, headSha, pristineState } from "../../core/git.ts";
import { type Args, hash, no, ok, str } from "../context.ts";
import { type Ask, type Task, loadLedger, nextAskId, taskOfPeer } from "../ledger.ts";
import { clip, letters } from "../letters.ts";
import type { Tool } from "../services.ts";

function handbackBody(task: Task, args: Args, commit: string | undefined, uncommitted: boolean): { outcome: string; body: string } {
  if (task.kind === "review") {
    const outcome = str(args.verdict) || "changes";
    return { outcome, body: [`Verdict: ${outcome}`, "", str(args.findings) || "No findings given.", "", `Checks: ${str(args.checks) || "not given"}`].join("\n") };
  }
  const outcome = str(args.outcome) || "complete";
  const lines = [
    `Outcome: ${outcome}`,
    `Commit: ${commit ?? "none"}${uncommitted ? " (the working copy still has uncommitted changes)" : ""}`,
    "",
    str(args.summary) || "No summary given.",
    "",
    `Checks: ${str(args.checks) || "not given"}`,
    `Left undone: ${str(args.leftUndone) || "nothing"}`,
    `Discovered: ${str(args.discovered) || "nothing"}`,
  ];
  return { outcome, body: lines.join("\n") };
}

export const done: Tool = async ({ ctx }, caller, args) => {
  const { project } = caller;
  const ledger = loadLedger(project.state);
  const task = taskOfPeer(ledger, caller.id);
  if (!task) return no("No task is assigned to you.");
  if (["merged", "cut"].includes(task.status)) return no(`This task is already ${task.status === "merged" ? "accepted" : "cut"}; there is nothing to hand back.`);
  const review = task.kind === "review";
  const commit = review ? undefined : str(args.commit) || (task.worktree ? await headSha(task.worktree) : undefined);
  // Only what git actually said: a copy it could not read is not a copy with work left in it.
  const uncommitted = !review && task.worktree ? (await pristineState(task.worktree)) === "dirty" : false;
  const { outcome, body } = handbackBody(task, args, commit, uncommitted);
  const file = join(project.state, "handbacks", `${task.id}-${Date.now()}.md`);
  mkdirSync(join(project.state, "handbacks"), { recursive: true });
  writeFileSync(file, `# ${task.id} ${task.title}\n\n${body}\n`);
  await ctx.setTask(project, task.id, (entry) => {
    entry.status = "done";
    entry.silent = 0;
    entry.handback = { file, outcome, commit, summary: clip(str(args.summary) || str(args.findings), 400), at: Date.now() };
  });
  const heading = review ? { ...task, title: task.of ? `review of ${task.of}` : `review: ${task.title}` } : task;
  await ctx.post(ledger.lanes[task.lane]?.lead, `done:${task.id}:${hash(body)}`, letters.handback(heading, file, body, caller.id));
  ctx.event(project, { kind: review ? "review.done" : "task.done", task: task.id, outcome, commit });
  // A commit made while the copy is off its branch — mid-bisect, most likely — belongs to no branch,
  // and the copy's own record of it goes when the copy does. Said here, while it can still be fixed.
  const branch = review ? undefined : ledger.lanes[task.lane]?.branch;
  const meant = task.mode === "parallel" ? task.branch : branch;
  const adrift = !review && meant && task.worktree ? (await currentBranch(task.worktree)) !== meant : false;
  const reminder = uncommitted
    ? " Your working copy still has uncommitted changes: commit them before ending your turn."
    : adrift
      ? ` Your working copy is not on ${meant} any more, so anything you committed is on no branch and will be collected. Put it back — after a bisect that is git bisect reset — and commit there before your turn ends.`
      : "";
  return ok(`Handed back.${reminder} End your turn now; if anything changes you will get a message.`);
};

export const ask: Tool = async ({ ctx }, caller, args) => {
  const question = str(args.question);
  if (!question) return no("ask needs a question.");
  const { project } = caller;
  const ledger = loadLedger(project.state);
  const task = taskOfPeer(ledger, caller.id);
  const lane = task ? ledger.lanes[task.lane] : undefined;
  if (!task || !lane?.lead) return no("Nobody is assigned to answer you; end your turn with the question.");
  const tried = str(args.tried);
  const entry = await ctx.ledger(project, (current) => {
    const created: Ask = {
      id: nextAskId(current),
      from: caller.id,
      fromRole: caller.role.role,
      to: lane.lead!,
      lane: lane.id,
      task: task.id,
      kind: "blocked",
      text: tried ? `${question}\n\nTried: ${tried}` : question,
      status: "open",
      openedAt: Date.now(),
      reminders: 0,
    };
    current.asks[created.id] = created;
    return { ...created };
  });
  await ctx.post(lane.lead, `ask:${entry.id}`, letters.askTo(entry, `the Peer on ${task.id} (${task.title})`));
  ctx.event(project, { kind: "ask.opened", ask: entry.id, from: caller.id, to: lane.lead });
  return ok(`Asked as ${entry.id}. End your turn; the answer arrives as a message.`);
};
