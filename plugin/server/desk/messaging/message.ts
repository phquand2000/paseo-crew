import { can } from "../../catalog/kit/roles.ts";
import { SETTLED } from "../../domain/task.ts";
import { type Caller, type ToolReply, no, ok } from "../context.ts";
import { repeatsIncident } from "../store/incidents.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, findLane, findTask, laneOfLead } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { loadLedger } from "../store/ledger.ts";
import { type Sending } from "../letters/message-letters.ts";
import { messageLetters } from "../letters/message-letters.ts";
import type { DeskServices } from "../services.ts";

/** Gives `text` to a seat as mail it reads once it can; one stopped on a permission reads nothing until the Human decides it. */
async function handTo(
  { mail, roster }: Pick<DeskServices, "mail" | "roster">,
  to: { target: string; from: string; who: string },
  sending: Sending,
  text: string,
): Promise<string> {
  const posted = await mail.post(to.target, messageLetters.message(to.from, text, sending));
  if (posted === "sent") return `Delivered to ${to.who}.`;
  const seat = await roster.look(to.target).catch(() => undefined);
  if ((seat?.pendingPermissions?.length ?? 0) > 0)
    return `Queued for ${to.who}, which is stopped on a permission only the Human can give; it reads this once that is decided.`;
  return `Queued for ${to.who}; it reads this as soon as it can take it.`;
}

const unread = (who: string) => `${who} is not seated any more, so a message would wait for nobody.`;

/** Why a settled task takes no message: a merged one's Peer is kept only to take rework, which would wake it in a copy it no longer holds. */
const settled = (task: Task) =>
  task.status === "merged"
    ? `${task.id} is merged, and its Peer is kept only to take rework: send rework if its work must change.`
    : SETTLED.includes(task.status)
      ? `${task.id} is ${task.status}, and its Peer went with it.`
      : undefined;

/** Whoever supervises reaches a lane's Lead, or a task's Peer with its Lead told first. */
async function fromOwner(
  desk: DeskServices,
  caller: Caller,
  ledger: Ledger,
  sending: Sending,
  text: string,
): Promise<ToolReply> {
  const lane = findLane(ledger, sending.to);
  if (lane) return toLead(desk, caller, lane, sending, text);
  const task = findTask(ledger, sending.to);
  if (!task?.peer) return no(`There is no lane or task ${sending.to}.`);
  return toPeer(desk, caller, ledger, task, task.peer, sending, text);
}

async function toLead(
  desk: DeskServices,
  caller: Caller,
  lane: Lane,
  sending: Sending,
  text: string,
): Promise<ToolReply> {
  // A Lead kept after its lane closed is still there to ask about it.
  if (lane.status === "waiting" || !lane.lead) return no(`Lane ${lane.id} has no running Lead.`);
  if (!(await desk.roster.seated(lane.lead))) return no(unread(`The Lead of ${lane.id} (${lane.lead})`));
  const refused = repeatsIncident(caller.project.state, lane.lead, text);
  if (refused) return no(refused);
  const who = `the Lead ${lane.status === "closed" ? "kept from" : "of"} ${lane.id}`;
  return ok(await handTo(desk, { target: lane.lead, from: "the owner", who }, sending, text));
}

/** The Supervisor may reach a Peer directly, but its Lead is always told first: no hidden command chains. */
async function toPeer(
  desk: DeskServices,
  caller: Caller,
  ledger: Ledger,
  task: Task,
  peer: string,
  sending: Sending,
  text: string,
): Promise<ToolReply> {
  const { mail, roster } = desk;
  // Checked before anything is sent, so a settled task never gets a RECONCILE.
  const done = settled(task);
  if (done) return no(done);
  if (!(await roster.seated(peer))) return no(unread(`The Peer on ${task.id}`));
  const lane = ledger.lanes[task.lane];
  const onLane = lane?.status === "open" ? lane.lead : undefined;
  // The ledger says who the Lead is; only Paseo says whether it is still there to be told.
  const lead = onLane && (await roster.seated(onLane)) ? onLane : undefined;
  if (!lane || !lead)
    return no(
      `${task.id} has no running Lead to tell. Reaching its Peer without one would leave nobody holding the room's state, which is the one thing this must not do. Reopen the lane's Lead, or say it to the lane.`,
    );
  const refused = repeatsIncident(caller.project.state, peer, text);
  if (refused) return no(refused);
  await mail.post(lead, messageLetters.reconciled(lane, task, peer, text, sending));
  const handed = await handTo(
    desk,
    { target: peer, from: "the project owner", who: `the Peer on ${task.id}` },
    sending,
    text,
  );
  return ok(`${handed} Its Lead has been told what reached it and what is still its own.`);
}

/** A message from whoever supervises to a lane's Lead or a task's Peer, or from a Lead to a Peer of its own lane. */
export async function sendMessage(
  desk: DeskServices,
  caller: Caller,
  sent: { to: string; text: string },
): Promise<ToolReply> {
  const { to, text } = sent;
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
  if (refused) return no(refused);
  return ok(await handTo(desk, { target: task.peer, from: "your lead", who: `the Peer on ${task.id}` }, sending, text));
}
