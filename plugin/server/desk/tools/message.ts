import { z } from "zod";
import { can } from "../../catalog/kit.ts";
import { SETTLED } from "../../domain/task.ts";
import { type Caller, type ToolReply, no, ok, str } from "../context.ts";
import { repeatsIncident } from "../incidents.ts";
import { type Ledger, type Task, findLane, findTask, laneOfLead, loadLedger } from "../ledger.ts";
import { type Sending, letters } from "../letters.ts";
import { type DeskServices, defineTool } from "../services.ts";

/** Gives `text` to a seat as mail it reads once it can; one stopped on a permission reads nothing until the Human decides it. */
async function handTo({ ctx, roster }: DeskServices, to: { target: string; from: string; who: string }, sending: Sending, text: string): Promise<string> {
  const posted = await ctx.post(to.target, letters.message(to.from, text, sending));
  if (posted === "sent") return `Delivered to ${to.who}.`;
  const seat = await roster.look(to.target).catch(() => undefined);
  if ((seat?.pendingPermissions?.length ?? 0) > 0) return `Queued for ${to.who}, which is stopped on a permission only the Human can give; it reads this once that is decided.`;
  return `Queued for ${to.who}; it reads this as soon as it can take it.`;
}

const unread = (who: string) => `${who} is not seated any more, so a message would wait for nobody.`;

const settled = (task: Task) => (SETTLED.includes(task.status) ? `${task.id} is ${task.status}, and its Peer has been put away with it.` : undefined);

/** Whoever supervises reaches a lane's Lead, or a task's Peer with its Lead told first. */
async function fromOwner(desk: DeskServices, caller: Caller, ledger: Ledger, sending: Sending, text: string): Promise<ToolReply> {
  const { ctx, roster } = desk;
  const lane = findLane(ledger, sending.to);
  if (lane) {
    // A Lead kept after its lane closed is still there to ask about it.
    if (lane.status === "waiting" || !lane.lead) return no(`Lane ${lane.id} has no running Lead.`);
    if (!(await roster.seated(lane.lead))) return no(unread(`The Lead of ${lane.id} (${lane.lead})`));
    const refused = repeatsIncident(caller.project.state, lane.lead, text);
    return refused ? no(refused) : ok(await handTo(desk, { target: lane.lead, from: "the owner", who: `the Lead ${lane.status === "closed" ? "kept from" : "of"} ${lane.id}` }, sending, text));
  }
  const task = findTask(ledger, sending.to);
  if (!task?.peer) return no(`There is no lane or task ${sending.to}.`);
  // Checked before anything is sent, so a settled task never gets a RECONCILE.
  const done = settled(task);
  if (done) return no(done);
  if (!(await roster.seated(task.peer))) return no(unread(`The Peer on ${task.id}`));
  const laneOf = ledger.lanes[task.lane];
  const onLane = laneOf?.status === "open" ? laneOf.lead : undefined;
  // The ledger says who the Lead is; only Paseo says whether it is still there to be told.
  const lead = onLane && (await roster.seated(onLane)) ? onLane : undefined;
  if (!laneOf || !lead) {
    return no(`${task.id} has no running Lead to tell. Reaching its Peer without one would leave nobody holding the room's state, which is the one thing this must not do. Reopen the lane's Lead, or say it to the lane.`);
  }
  const refused = repeatsIncident(caller.project.state, task.peer, text);
  if (refused) return no(refused);
  // The Lead is told first, so it is never the last to know what reached its own Peer.
  await ctx.post(lead, letters.reconciled(laneOf, task, task.peer, text, sending));
  return ok(`${await handTo(desk, { target: task.peer, from: "the project owner", who: `the Peer on ${task.id}` }, sending, text)} Its Lead has been told what reached it and what is still its own.`);
}

export const message = defineTool({
  name: "message",
  input: z.strictObject({ to: z.string(), text: z.string() }),
  async handle(desk, caller, args) {
    const to = str(args.to);
    const text = str(args.text);
    const ledger = loadLedger(caller.project.state);
    const sending: Sending = { by: caller.id, to, at: Date.now() };
    if (can(caller.role, "supervise")) return fromOwner(desk, caller, ledger, sending, text);
    const lane = laneOfLead(ledger, caller.id);
    const task = findTask(ledger, to);
    if (!lane || !task || task.lane !== lane.id || !task.peer) return no(`${to} is not a task in your lane.`);
    const done = settled(task);
    if (done) return no(done);
    if (!(await desk.roster.seated(task.peer))) return no(unread(`The Peer on ${task.id}`));
    const refused = repeatsIncident(caller.project.state, task.peer, text);
    return refused ? no(refused) : ok(await handTo(desk, { target: task.peer, from: "your lead", who: `the Peer on ${task.id}` }, sending, text));
  },
});
