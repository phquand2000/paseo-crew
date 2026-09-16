import { diffCounts, git, headSha, isPristine, outsideOwned, resetHard } from "../../core/git.ts";
import { firstOverlap, serialHits } from "../../core/scope.ts";
import { type Args, type Caller, errorText, hash, no, ok, str, strs } from "../context.ts";
import { gateNote, laneGate } from "../gates.ts";
import {
  type Ask,
  type AskKind,
  type Lane,
  type Ledger,
  type Slot,
  type Task,
  type TaskStatus,
  activeTasks,
  findTask,
  laneOfLead,
  loadLedger,
  nextAskId,
  nextTaskId,
  slugify,
} from "../ledger.ts";
import { clip, letters } from "../letters.ts";
import { type Project, loadConfig } from "../project.ts";
import type { DeskServices, Tool } from "../services.ts";

const WRITING: TaskStatus[] = ["running", "rework"];

function laneTask(ledger: Ledger, caller: Caller, id: string): { lane: Lane; task: Task } | string {
  const lane = laneOfLead(ledger, caller.id);
  const task = findTask(ledger, id);
  if (!lane) return "You have no open lane.";
  if (!task || task.lane !== lane.id) return `${id} is not a task in your lane.`;
  return { lane, task };
}

function placementProblem(desk: DeskServices, project: Project, ledger: Ledger, lane: Lane, owned: string[], parallel: boolean): string | undefined {
  const active = activeTasks(ledger, lane.id).filter((task) => task.kind === "code");
  const limit = desk.ctx.team(project).limits.tasksPerLane;
  if (active.length >= limit) return `${limit} tasks are already active in your lane; accept, cut or wait for one first.`;
  if (!parallel) {
    const writer = active.find((task) => task.mode !== "parallel" && WRITING.includes(task.status));
    return writer
      ? `${writer.id} is still writing in the lane's working copy, and it holds one writer at a time. Wait for its hand-back, or set parallel only for owned paths independent of it.`
      : undefined;
  }
  const serial = serialHits(owned, loadConfig(project.state).serialOnly);
  if (serial.length > 0) return `A parallel task can't own ${serial.join(", ")}; run it in the lane's working copy instead.`;
  for (const task of active) {
    const clash = firstOverlap(owned, task.owned);
    if (clash) return `The owned paths overlap ${task.id} at ${clash}; run it after ${task.id} instead of in parallel.`;
  }
  return undefined;
}

function recordTask(desk: DeskServices, project: Project, lane: Lane, args: Args, parallel: boolean, startSha: string | undefined): Promise<Task> {
  const title = str(args.title);
  return desk.ctx.ledger(project, (current) => {
    const id = nextTaskId(current, current.lanes[lane.id]!, "code");
    const now = Date.now();
    const task: Task = {
      id,
      lane: lane.id,
      kind: "code",
      mode: parallel ? "parallel" : "lane",
      title,
      goal: str(args.goal),
      acceptance: strs(args.acceptance),
      owned: strs(args.owned),
      outOfScope: strs(args.outOfScope),
      context: str(args.context) || undefined,
      skills: strs(args.skills),
      branch: parallel ? `task/${id.toLowerCase()}-${slugify(title, 24)}` : lane.branch,
      worktree: parallel ? undefined : lane.worktree,
      slot: parallel ? undefined : lane.slot,
      startSha,
      status: "running",
      openedAt: now,
      updatedAt: now,
      silent: 0,
    };
    current.tasks[id] = task;
    return { ...task };
  });
}

export const startTask: Tool = async (desk, paseo, caller, args) => {
  const { ctx, slots, agents } = desk;
  const { project } = caller;
  const owned = strs(args.owned);
  const parallel = args.parallel === true;
  if (!str(args.title) || !str(args.goal) || strs(args.acceptance).length === 0 || owned.length === 0 || strs(args.outOfScope).length === 0)
    return no("start_task needs a title, a goal, acceptance, owned paths and what is out of scope.");
  const ledger = loadLedger(project.state);
  const lane = laneOfLead(ledger, caller.id);
  if (!lane?.slot || !lane.worktree) return no("You have no open lane.");
  const problem = placementProblem(desk, project, ledger, lane, owned, parallel);
  if (problem) return no(problem);
  const task = await recordTask(desk, project, lane, args, parallel, parallel ? undefined : await headSha(lane.worktree));
  try {
    let slot: Pick<Slot, "id" | "path" | "workspaceId">;
    if (parallel) {
      slot = await slots.acquire(paseo, project, task.branch!, lane.branch, { task: task.id });
      await ctx.setTask(project, task.id, (entry) => Object.assign(entry, { slot: slot.id, worktree: slot.path }));
    } else {
      slot = loadLedger(project.state).slots[lane.slot]!;
    }
    const peer = await agents.start(paseo, project, slot, "peer", {
      parent: caller.id,
      title: `${task.id} ${task.title}`,
      prompt: letters.brief(task, lane),
      labels: { "seatworks.lane": lane.id, "seatworks.task": task.id, "seatworks.role": "peer" },
    });
    await ctx.setTask(project, task.id, (entry) => {
      entry.peer = peer;
    });
    await ctx.ledger(project, (current) => {
      current.agents[peer] = { id: peer, role: "peer", lane: lane.id, task: task.id };
    });
    ctx.event(project, { kind: "task.started", task: task.id, peer, mode: task.mode, slot: slot.id });
    const where = parallel ? `in its own working copy ${slot.id} on ${task.branch}` : `in the lane's working copy on ${lane.branch}`;
    return ok(`Started ${task.id} ${where} with Peer ${peer}. Its hand-back arrives as mail; there is nothing to wait for in this turn.`);
  } catch (error) {
    const failed = await ctx.setTask(project, task.id, (entry) => {
      entry.status = "cut";
    });
    if (failed && parallel) await slots.release(project, failed.slot, failed.branch);
    return no(`The Peer could not start: ${errorText(error)}`);
  }
};

export const startReview: Tool = async ({ ctx, agents }, paseo, caller, args) => {
  const { project } = caller;
  const focus = str(args.focus);
  if (!focus) return no("start_review needs a focus: the open question for the reviewer.");
  const ledger = loadLedger(project.state);
  const lane = laneOfLead(ledger, caller.id);
  if (!lane?.slot) return no("You have no open lane.");
  const target = str(args.task) ? findTask(ledger, str(args.task)) : undefined;
  if (str(args.task) && (!target || target.lane !== lane.id || target.kind !== "code")) return no(`${str(args.task)} is not a code task in your lane.`);
  const slotId = target?.mode === "parallel" && target.slot && ledger.slots[target.slot]?.task === target.id ? target.slot : lane.slot;
  const slot = ledger.slots[slotId];
  if (!slot) return no("The working copy for that review is gone.");
  const review = await ctx.ledger(project, (current) => {
    const id = nextTaskId(current, current.lanes[lane.id]!, "review");
    const now = Date.now();
    const created: Task = {
      id,
      lane: lane.id,
      kind: "review",
      mode: "lane",
      of: target?.id,
      title: target ? `Review ${target.id}` : str(args.title) || clip(focus.split(/\r?\n/)[0] ?? "Review", 50),
      goal: focus,
      acceptance: target?.acceptance ?? [],
      owned: [],
      outOfScope: [],
      context: lane.branch,
      worktree: slot.path,
      status: "running",
      openedAt: now,
      updatedAt: now,
      silent: 0,
    };
    current.tasks[id] = created;
    return { ...created };
  });
  try {
    const reviewer = await agents.start(paseo, project, slot, "reviewer", {
      parent: caller.id,
      title: `${review.id} ${target?.title ?? review.title}`,
      prompt: letters.reviewBrief(review, target, focus, lane.branch),
      labels: { "seatworks.lane": lane.id, "seatworks.task": review.id, "seatworks.role": "reviewer" },
    });
    await ctx.setTask(project, review.id, (entry) => {
      entry.peer = reviewer;
    });
    await ctx.ledger(project, (current) => {
      current.agents[reviewer] = { id: reviewer, role: "reviewer", lane: lane.id, task: review.id };
    });
    ctx.event(project, { kind: "review.started", task: review.id, of: target?.id ?? null, reviewer });
    return ok(`Started ${review.id}${target ? ` on ${target.id}` : ""} with reviewer ${reviewer}. The verdict arrives as mail.`);
  } catch (error) {
    await ctx.setTask(project, review.id, (entry) => {
      entry.status = "cut";
    });
    return no(`The reviewer could not start: ${errorText(error)}`);
  }
};

export const accept: Tool = async ({ ctx, agents, merges }, paseo, caller, args) => {
  const { project } = caller;
  const found = laneTask(loadLedger(project.state), caller, str(args.task));
  if (typeof found === "string") return no(found);
  const { lane, task } = found;
  if (task.kind !== "code") return no(`${task.id} is a review; cut it when you are done with it.`);
  if (["merged", "queued", "merging", "cut"].includes(task.status)) return no(`${task.id} is ${task.status}.`);
  if (task.mode === "parallel") {
    await ctx.setTask(project, task.id, (entry) => {
      entry.status = "queued";
    });
    const ahead = Object.values(loadLedger(project.state).tasks).filter((entry) => entry.status === "queued" || entry.status === "merging").length - 1;
    merges.enqueue(paseo, project, task.id);
    return ok(`${task.id} is in the merge queue${ahead > 0 ? ` behind ${ahead}` : ""}. MERGED or MERGE FAILED arrives as mail.`);
  }
  if (!lane.worktree || !(await isPristine(lane.worktree))) {
    return no(`The lane's working copy has uncommitted changes; send rework asking the Peer on ${task.id} to commit everything, then accept again.`);
  }
  const counts = await diffCounts(lane.worktree, task.startSha ?? lane.base, "HEAD");
  if (counts.files.length === 0) return no(`${task.id} has no commits since it started.`);
  const updated = await ctx.setTask(project, task.id, (entry) => {
    entry.status = "merged";
  });
  await ctx.post(paseo, lane.lead, `merge:${task.id}:merged:${Date.now()}`, letters.merged(task, counts, outsideOwned(counts.files, task.owned), gateNote(project)));
  if (updated) await agents.retire(paseo, project, updated);
  ctx.event(project, { kind: "task.accepted", task: task.id, mode: "lane" });
  return ok(`${task.id} is accepted; its commits are already on ${lane.branch}. The working copy is free for the next task.`);
};

export const rework: Tool = async ({ ctx }, paseo, caller, args) => {
  const text = str(args.text);
  if (!text) return no("rework needs text saying what must change.");
  const result = await ctx.ledger(caller.project, (ledger): Task | string => {
    const found = laneTask(ledger, caller, str(args.task));
    if (typeof found === "string") return found;
    const { task } = found;
    if (["merged", "cut", "queued", "merging"].includes(task.status)) return `${task.id} is ${task.status}.`;
    task.status = "rework";
    task.silent = 0;
    task.updatedAt = Date.now();
    return { ...task };
  });
  if (typeof result === "string") return no(result);
  if (!result.peer) return no(`${result.id} has no Peer.`);
  const handle = paseo.agents.ref(result.peer);
  await handle.refresh();
  if (handle.archivedAt) return no(`The Peer on ${result.id} is gone; cut the task and start a new one.`);
  await ctx.post(paseo, result.peer, `rework:${result.id}:${hash(text)}`, letters.rework(text));
  return ok(`Rework sent to the Peer on ${result.id}; its next hand-back arrives as mail.`);
};

export const cut: Tool = async ({ ctx, slots }, paseo, caller, args) => {
  const { project } = caller;
  const found = laneTask(loadLedger(project.state), caller, str(args.task));
  if (typeof found === "string") return no(found);
  const { lane, task } = found;
  if (task.status === "merged") return no(`${task.id} is already accepted.`);
  const updated = await ctx.setTask(project, task.id, (entry) => {
    entry.status = "cut";
  });
  if (!updated) return no(`${task.id} is gone.`);
  await ctx.archive(paseo, task.peer, true);
  let undone = "";
  if (task.kind === "code" && task.mode === "lane" && task.startSha && lane.worktree) {
    await resetHard(lane.worktree, task.startSha);
    await git(lane.worktree, ["clean", "-fd"]);
    undone = ` The lane's working copy is back at ${task.startSha.slice(0, 7)}.`;
  }
  if (task.kind === "code" && task.mode === "parallel") await slots.release(project, task.slot, task.branch);
  ctx.event(project, { kind: "task.cut", task: task.id, reason: str(args.reason) });
  return ok(`${task.id} is cut and its agent stopped.${undone}`);
};

export const ask: Tool = async ({ ctx }, paseo, caller, args) => {
  const kind = str(args.kind) as AskKind;
  const text = str(args.text);
  if (!["need", "blocked", "question"].includes(kind) || !text) return no("ask needs kind (need, blocked or question) and text.");
  const lane = laneOfLead(loadLedger(caller.project.state), caller.id);
  if (!lane) return no("You have no open lane.");
  const to = await ctx.supervisorFor(paseo, caller.project, lane.opener);
  if (!to) return no("Nobody above you is running to answer; keep working on your default and report when the lane is ready.");
  const entry = await ctx.ledger(caller.project, (ledger) => {
    const created: Ask = {
      id: nextAskId(ledger),
      from: caller.id,
      fromRole: "lead",
      to,
      lane: lane.id,
      kind,
      text,
      default: str(args.default) || undefined,
      status: "open",
      openedAt: Date.now(),
      reminders: 0,
    };
    ledger.asks[created.id] = created;
    return { ...created };
  });
  await ctx.post(paseo, to, `ask:${entry.id}`, letters.askTo(entry, `the Lead of ${lane.id} (${lane.title})`));
  ctx.event(caller.project, { kind: "ask.opened", ask: entry.id, from: caller.id, to });
  return ok(`Asked as ${entry.id}. Keep working on your default where you can; the answer arrives as mail.`);
};

export const report: Tool = async ({ ctx }, paseo, caller, args) => {
  const summary = str(args.summary);
  if (!summary) return no("report needs a summary.");
  const lane = laneOfLead(loadLedger(caller.project.state), caller.id);
  if (!lane) return no("You have no open lane.");
  if (args.ready === true) {
    const gate = await laneGate(ctx, caller.project, lane);
    if (!gate.ok) return no(`Not reported: the lane is not ready because ${gate.text}\nFix it with rework or start_task, then report again.`);
  }
  const to = await ctx.supervisorFor(paseo, caller.project, lane.opener);
  await ctx.post(paseo, to, `report:${lane.id}:${hash(summary)}`, letters.report(lane, summary, args.ready === true, strs(args.carried)));
  ctx.event(caller.project, { kind: "lane.report", lane: lane.id, ready: args.ready === true });
  return ok("Reported to the owner. Stay quiet until mail arrives.");
};
