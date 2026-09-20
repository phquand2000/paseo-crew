import { type Kit, can, roleNamed, rolesThatCan } from "../../catalog/kit.ts";
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

export const message: Tool = async ({ ctx, roster }, caller, args) => {
  const to = str(args.to);
  const text = str(args.text);
  if (!to || !text) return no("message needs to and text.");
  const ledger = loadLedger(caller.project.state);
  // Keyed by the event, not the words. Keyed on the text, the same instruction sent again was dropped
  // as a repeat — the Peer's letter and the Lead's RECONCILE both — while the sender was told it had
  // gone; `rework` was fixed for exactly this and `message` never was.
  const key = `message:${caller.id}:${hash(to, text)}:${Date.now()}`;
  const unread = (who: string) => `${who} is not seated any more, so a message would wait for nobody.`;
  const settled = (task: { id: string; status: string }) =>
    ["merged", "cut"].includes(task.status) ? `${task.id} is ${task.status === "merged" ? "accepted" : "cut"}, and its Peer has been put away with it.` : undefined;
  const deliver = async (target: string, from: string, who: string): Promise<string> => {
    const reached = await roster.answerQuestion(target, `From ${from}: ${text}`);
    if (reached === "answered") {
      ctx.event(caller.project, { kind: "question.answered", agent: target, by: caller.id });
      return `It was stopped on a question, so this went to ${who} as the answer, and it carries on.`;
    }
    const posted = await ctx.post(target, key, letters.message(from, text));
    if (posted === "sent") return `Delivered to ${who}.`;
    if (reached === "waiting") return `Queued for ${who}, which is stopped on a permission only the Human can give; it reads this once that is decided.`;
    return `Queued for ${who}; it reads this as soon as it can take it.`;
  };
  if (can(caller.role, "supervise")) {
    const lane = findLane(ledger, to);
    if (lane) {
      if (lane.status !== "open" || !lane.lead) return no(`Lane ${lane.id} has no running Lead.`);
      if (!(await roster.seated(lane.lead))) return no(unread(`The Lead of ${lane.id} (${lane.lead})`));
      return ok(await deliver(lane.lead, "the owner", `the Lead of ${lane.id}`));
    }
    const task = findTask(ledger, to);
    if (task?.peer) {
      // Checked before anything is sent: a RECONCILE telling the Lead a task "is still owned by" a Peer
      // and "still yours to judge" was going out for tasks already accepted and Peers already gone.
      const done = settled(task);
      if (done) return no(done);
      if (!(await roster.seated(task.peer))) return no(unread(`The Peer on ${task.id}`));
      const laneOf = ledger.lanes[task.lane];
      const onLane = laneOf?.status === "open" ? laneOf.lead : undefined;
      // The ledger says who the Lead is; only Paseo says whether it is still there to be told.
      const lead = onLane && (await roster.seated(onLane)) ? onLane : undefined;
      if (!laneOf || !lead) {
        return no(
          `${task.id} has no running Lead to tell. Reaching its Peer without one would leave nobody holding the room's state, which is the one thing this must not do. Reopen the lane's Lead, or say it to the lane.`,
        );
      }
      // The Lead is told first, so it is never the last to know what reached its own Peer.
      await ctx.post(lead, `reconcile:${key}`, letters.reconciled(laneOf, task, task.peer, text));
      return ok(`${await deliver(task.peer, "the project owner", `the Peer on ${task.id}`)} Its Lead has been told what reached it and what is still its own.`);
    }
    return no(`There is no lane or task ${to}.`);
  }
  const lane = laneOfLead(ledger, caller.id);
  const task = findTask(ledger, to);
  if (!lane || !task || task.lane !== lane.id || !task.peer) return no(`${to} is not a task in your lane.`);
  const done = settled(task);
  if (done) return no(done);
  if (!(await roster.seated(task.peer))) return no(unread(`The Peer on ${task.id}`));
  return ok(await deliver(task.peer, "your lead", `the Peer on ${task.id}`));
};

export const answer: Tool = async ({ ctx }, caller, args) => {
  const id = str(args.ask).toUpperCase();
  const text = str(args.text);
  if (!id || !text) return no("answer needs ask and text.");
  const result = await ctx.ledger(caller.project, (ledger): { ask: Ask; waitingRole?: string } | string => {
    const ask = ledger.asks[id];
    if (!ask) return `There is no ask ${id}.`;
    if (ask.status !== "open") return `Ask ${id} is already answered.`;
    if (ask.to !== caller.id && !can(caller.role, "supervise")) return `Ask ${id} was not addressed to you.`;
    ask.status = "answered";
    ask.answer = text;
    return { ask: { ...ask }, waitingRole: ledger.agents[ask.to]?.role };
  });
  if (typeof result === "string") return no(result);
  const { ask } = result;
  // Answering an ask that was put to someone else is allowed — the round escalates unanswered ones
  // upward for exactly that. Leaving whoever it was put to out of it is not: they are told first,
  // the same way a message that reaches their Peer tells them first. A Lead or Peer knows the level
  // above it as the owner, by design; a seat that supervises is told which seat it was.
  const waiting = ask.to === caller.id ? undefined : ask.to;
  const by = waiting && can(roleNamed(ctx.kit, result.waitingRole ?? ""), "supervise") ? `${caller.role.label} ${caller.id}` : "the owner";
  if (waiting) await ctx.post(waiting, `answeredFor:${ask.id}`, letters.answeredFor(ask, by, can(roleNamed(ctx.kit, result.waitingRole ?? ""), "lead")));
  const posted = await ctx.post(ask.from, `answer:${ask.id}`, letters.answered(ask));
  ctx.event(caller.project, { kind: "ask.answered", ask: ask.id, by: caller.id, told: waiting ?? null });
  return ok(`Answered ${ask.id}; the asker ${posted === "sent" ? "has it" : "reads it as soon as it can take it"}.${waiting ? " Whoever it was waiting on has been told what it was answered with." : ""}`);
};

export const status: Tool = async ({ roster }, caller) => {
  const ledger = loadLedger(caller.project.state);
  const seats = new Map((await roster.open()).map((seat) => [seat.id, seat]));
  const lane = can(caller.role, "lead") ? laneOfLead(ledger, caller.id)?.id : undefined;
  return ok(statusText(caller.project, ledger, loadConfig(caller.project.state), seats, Date.now(), lane));
};
