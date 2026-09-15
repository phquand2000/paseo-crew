import { openSeats } from "../../core/paseo.ts";
import { hash, no, ok, str } from "../context.ts";
import { type Ask, findLane, findTask, laneOfLead, loadLedger } from "../ledger.ts";
import { letters } from "../letters.ts";
import { loadConfig } from "../project.ts";
import type { Tool } from "../services.ts";
import { statusText } from "../status.ts";

export const message: Tool = async ({ ctx }, paseo, caller, args) => {
  const to = str(args.to);
  const text = str(args.text);
  if (!to || !text) return no("message needs to and text.");
  const ledger = loadLedger(caller.project.state);
  const key = `message:${caller.id}:${hash(to, text)}`;
  if (caller.team === "supervisor") {
    const lane = findLane(ledger, to);
    if (lane) {
      if (lane.status !== "open" || !lane.lead) return no(`Lane ${lane.id} has no running Lead.`);
      await ctx.post(paseo, lane.lead, key, letters.message("the owner", text));
      return ok(`Queued for the Lead of ${lane.id}; it arrives when that Lead is idle.`);
    }
    const task = findTask(ledger, to);
    if (task?.peer) {
      await ctx.post(paseo, task.peer, key, letters.message("the project owner", text));
      await ctx.post(paseo, ledger.lanes[task.lane]?.lead, `copy:${key}`, letters.copied(task, text));
      return ok(`Queued for the Peer on ${task.id}; its Lead gets a copy.`);
    }
    return no(`There is no lane or task ${to}.`);
  }
  const lane = laneOfLead(ledger, caller.id);
  const task = findTask(ledger, to);
  if (!lane || !task || task.lane !== lane.id || !task.peer) return no(`${to} is not a task in your lane.`);
  await ctx.post(paseo, task.peer, key, letters.message("your lead", text));
  return ok(`Queued for the Peer on ${task.id}; it arrives when that Peer's turn ends.`);
};

export const answer: Tool = async ({ ctx }, paseo, caller, args) => {
  const id = str(args.ask).toUpperCase();
  const text = str(args.text);
  if (!id || !text) return no("answer needs ask and text.");
  const result = await ctx.ledger(caller.project, (ledger): Ask | string => {
    const ask = ledger.asks[id];
    if (!ask) return `There is no ask ${id}.`;
    if (ask.status !== "open") return `Ask ${id} is already answered.`;
    if (ask.to !== caller.id && caller.team !== "supervisor") return `Ask ${id} was not addressed to you.`;
    ask.status = "answered";
    ask.answer = text;
    return { ...ask };
  });
  if (typeof result === "string") return no(result);
  await ctx.post(paseo, result.from, `answer:${result.id}`, letters.answered(result));
  ctx.event(caller.project, { kind: "ask.answered", ask: result.id, by: caller.id });
  return ok(`Answered ${result.id}; the asker gets it when idle.`);
};

export const status: Tool = async (_desk, paseo, caller) => {
  const ledger = loadLedger(caller.project.state);
  const seats = new Map((await openSeats(paseo)).map((seat) => [seat.id, seat]));
  const lane = caller.team === "lead" ? laneOfLead(ledger, caller.id)?.id : undefined;
  return ok(statusText(caller.project, ledger, loadConfig(caller.project.state), seats, Date.now(), lane));
};
