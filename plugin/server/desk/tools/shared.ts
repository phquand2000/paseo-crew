import { type Kit, can, rolesThatCan } from "../../catalog/kit.ts";
import { hash, no, ok, str } from "../context.ts";
import { type Ask, findLane, findTask, laneOfLead, loadLedger } from "../ledger.ts";
import { letters } from "../letters.ts";
import { loadConfig } from "../project.ts";
import type { Tool } from "../services.ts";
import { statusText } from "../status.ts";

/**
 * Why nobody could be seated: the kit holds no such role, or the one asked for is not one of them.
 *
 * The second case names the roles that do hold the capability, because a caller that may choose has
 * to be able to find out what there is to choose from — the kit is data and the desk is the only
 * thing that has read it.
 */
export function namedOrNot(kit: Kit, capability: string, named: string, doing: string): string {
  const holders = rolesThatCan(kit, capability).map((role) => role.role);
  if (holders.length === 0) return `No role in this kit can ${doing}.`;
  return `This kit has no ${named} that can ${doing}. These can: ${holders.sort().join(", ")}.`;
}

async function alive(roster: { look(id: string): Promise<{ archivedAt?: string | null }> }, agentId: string): Promise<boolean> {
  try {
    return !(await roster.look(agentId)).archivedAt;
  } catch {
    return false;
  }
}

export const message: Tool = async ({ ctx, roster }, caller, args) => {
  const to = str(args.to);
  const text = str(args.text);
  if (!to || !text) return no("message needs to and text.");
  const ledger = loadLedger(caller.project.state);
  const key = `message:${caller.id}:${hash(to, text)}`;
  if (can(caller.role, "supervise")) {
    const lane = findLane(ledger, to);
    if (lane) {
      if (lane.status !== "open" || !lane.lead) return no(`Lane ${lane.id} has no running Lead.`);
      await ctx.post(lane.lead, key, letters.message("the owner", text));
      return ok(`Queued for the Lead of ${lane.id}; it arrives when that Lead is idle.`);
    }
    const task = findTask(ledger, to);
    if (task?.peer) {
      const laneOf = ledger.lanes[task.lane];
      const onLane = laneOf?.status === "open" ? laneOf.lead : undefined;
      // The ledger says who the Lead is; only Paseo says whether it is still there to be told.
      const lead = onLane && (await alive(roster, onLane)) ? onLane : undefined;
      if (!laneOf || !lead) {
        return no(
          `${task.id} has no running Lead to tell. Reaching its Peer without one would leave nobody holding the room's state, which is the one thing this must not do. Reopen the lane's Lead, or say it to the lane.`,
        );
      }
      // The Lead is told first, so it is never the last to know what reached its own Peer.
      await ctx.post(lead, `reconcile:${key}`, letters.reconciled(laneOf, task, task.peer, text));
      await ctx.post(task.peer, key, letters.message("the project owner", text));
      return ok(`Queued for the Peer on ${task.id}. Its Lead has been told what reached it and what is still its own.`);
    }
    return no(`There is no lane or task ${to}.`);
  }
  const lane = laneOfLead(ledger, caller.id);
  const task = findTask(ledger, to);
  if (!lane || !task || task.lane !== lane.id || !task.peer) return no(`${to} is not a task in your lane.`);
  await ctx.post(task.peer, key, letters.message("your lead", text));
  return ok(`Queued for the Peer on ${task.id}; it arrives when that Peer's turn ends.`);
};

export const answer: Tool = async ({ ctx }, caller, args) => {
  const id = str(args.ask).toUpperCase();
  const text = str(args.text);
  if (!id || !text) return no("answer needs ask and text.");
  const result = await ctx.ledger(caller.project, (ledger): Ask | string => {
    const ask = ledger.asks[id];
    if (!ask) return `There is no ask ${id}.`;
    if (ask.status !== "open") return `Ask ${id} is already answered.`;
    if (ask.to !== caller.id && !can(caller.role, "supervise")) return `Ask ${id} was not addressed to you.`;
    ask.status = "answered";
    ask.answer = text;
    return { ...ask };
  });
  if (typeof result === "string") return no(result);
  // Answering an ask that was put to someone else is allowed — the round escalates unanswered ones
  // upward for exactly that. Leaving whoever it was put to out of it is not: they are told first,
  // the same way a message that reaches their Peer tells them first.
  const waiting = result.to === caller.id ? undefined : result.to;
  if (waiting) await ctx.post(waiting, `answeredFor:${result.id}`, letters.answeredFor(result, "the owner"));
  await ctx.post(result.from, `answer:${result.id}`, letters.answered(result));
  ctx.event(caller.project, { kind: "ask.answered", ask: result.id, by: caller.id, told: waiting ?? null });
  return ok(`Answered ${result.id}; the asker gets it when idle.${waiting ? " Whoever it was waiting on has been told what it was answered with." : ""}`);
};

export const status: Tool = async ({ roster }, caller) => {
  const ledger = loadLedger(caller.project.state);
  const seats = new Map((await roster.open()).map((seat) => [seat.id, seat]));
  const lane = can(caller.role, "lead") ? laneOfLead(ledger, caller.id)?.id : undefined;
  return ok(statusText(caller.project, ledger, loadConfig(caller.project.state), seats, Date.now(), lane));
};
