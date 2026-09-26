import { can, roleNamed } from "../../catalog/kit.ts";
import { ASK } from "../../domain/ask.ts";
import { SETTLED } from "../../domain/task.ts";
import { askLetters } from "../ask-letters.ts";
import { type Caller, type ToolReply, no, ok } from "../context.ts";
import { repeatsIncident } from "../incidents.ts";
import { type Ask, type Ledger, laneOfLead, loadLedger, nextAskId, taskOfPeer } from "../ledger.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";

type Asking = Pick<Ask, "from" | "fromRole" | "to" | "lane" | "task" | "kind" | "text" | "default">;

/** A new open ask, numbered in `ledger`. */
function newAsk(ledger: Ledger, asking: Asking): Ask {
  return { id: nextAskId(ledger), ...asking, status: "open", openedAt: Date.now(), reminders: 0 };
}

/** A Lead asks whoever supervises its lane, and works on its default while it waits. */
export async function askOwner(
  { ledgers, mail, roster }: Pick<DeskServices, "ledgers" | "mail" | "roster">,
  caller: Caller,
  asked: { kind: string; text: string; default: string },
): Promise<ToolReply> {
  const { project } = caller;
  const lane = laneOfLead(loadLedger(project.state), caller.id);
  if (!lane) return no("You have no open lane.");
  const to = await roster.supervisorFor(project, lane.opener);
  if (!to)
    return no("Nobody above you is running to answer; keep working on your default and report when the lane is ready.");
  // Opened on the lane the caller still leads: it may have closed while whoever answers was looked up.
  const entry = ledgers.transact(project, (ledger) => {
    if (laneOfLead(ledger, caller.id)?.id !== lane.id) return undefined;
    const from = { from: caller.id, fromRole: caller.role.role, to, lane: lane.id };
    const created = newAsk(ledger, { ...from, kind: asked.kind, text: asked.text, default: asked.default });
    ledger.asks[created.id] = created;
    return { ...created };
  });
  if (!entry) return no("You have no open lane.");
  await mail.post(to, askLetters.askTo(entry, `the Lead of ${lane.id} (${lane.title})`, "supervisor"));
  recordEvent(project, { kind: "ask.opened", ask: entry.id, from: caller.id, to });
  return ok(`Asked as ${entry.id}. Keep working on your default where you can; the answer arrives as mail.`);
}

/** A Peer or reviewer asks up: its Lead, or the level above when the Lead is gone; a Peer's best guess is its default. */
export async function askUp(
  { ledgers, mail, roster }: Pick<DeskServices, "ledgers" | "mail" | "roster">,
  caller: Caller,
  asked: { question: string; tried: string; guess?: string },
): Promise<ToolReply> {
  const { project } = caller;
  const ledger = loadLedger(project.state);
  const task = taskOfPeer(ledger, caller.id);
  const lane = task ? ledger.lanes[task.lane] : undefined;
  if (!task || !lane?.lead) return no("Nobody is assigned to answer you; end your turn with the question.");
  // A gone Lead would never answer; it goes up a level instead, and the Peer is told so.
  const to = (await roster.seated(lane.lead)) ? lane.lead : await roster.supervisorFor(project, lane.opener);
  if (!to)
    return no(
      "Your lead is not there and nobody above it is either, so nobody can answer now. Carry on with your default where you can, and end your turn with the question.",
    );
  const text = asked.tried ? `${asked.question}\n\nTried: ${asked.tried}` : asked.question;
  // Opened for the task the caller still works: it may have been cut while whoever answers was looked up.
  const entry = ledgers.transact(project, (current) => {
    const now = taskOfPeer(current, caller.id);
    if (now?.id !== task.id || SETTLED.includes(now.status)) return undefined;
    const from = { from: caller.id, fromRole: caller.role.role, to, lane: lane.id, task: task.id };
    const created = newAsk(current, { ...from, kind: "question", text, default: asked.guess });
    current.asks[created.id] = created;
    return { ...created };
  });
  if (!entry)
    return no(`${task.id} was accepted or cut while you asked, so there is nothing to ask about; end your turn.`);
  const reader = to === lane.lead ? "lead" : "supervisor";
  await mail.post(to, askLetters.askTo(entry, `the Peer on ${task.id} (${task.title})`, reader));
  recordEvent(project, { kind: "ask.opened", ask: entry.id, from: caller.id, to });
  const owner = to === lane.lead ? "" : ", of the owner, because your lead is not there";
  return ok(`Asked as ${entry.id}${owner}. End your turn; the answer arrives as a message.`);
}

/** Answers an open ask; one put to someone else may be answered by whoever supervises, and that seat is told first. */
export async function answerAsk(
  { kit, ledgers, mail }: Pick<DeskServices, "kit" | "ledgers" | "mail">,
  caller: Caller,
  answered: { ask: string; text: string },
): Promise<ToolReply> {
  const id = answered.ask.toUpperCase();
  const { text } = answered;
  const refused = repeatsIncident(caller.project.state, loadLedger(caller.project.state).asks[id]?.from, text);
  if (refused) return no(refused);
  const result = ledgers.transact(caller.project, (ledger): { ask: Ask; waitingRole?: string } | string => {
    const ask = ledger.asks[id];
    if (!ask) return `There is no ask ${id}.`;
    if (!ASK.may(ask.status, "answer")) return `Ask ${id} is already answered.`;
    if (ask.to !== caller.id && !can(caller.role, "supervise")) return `Ask ${id} was not addressed to you.`;
    ASK.move(ask, "answer");
    ask.answer = text;
    return { ask: { ...ask }, waitingRole: ledger.agents[ask.to]?.role };
  });
  if (typeof result === "string") return no(result);
  const { ask } = result;
  // Answering an ask put to someone else is allowed (the round escalates them), but that seat is told first.
  const waiting = ask.to === caller.id ? undefined : ask.to;
  const waitingRole = roleNamed(kit, result.waitingRole ?? "");
  if (waiting) {
    const by = can(waitingRole, "supervise") ? `${caller.role.label} ${caller.id}` : "the owner";
    await mail.post(waiting, askLetters.answeredFor(ask, by, can(waitingRole, "lead")));
  }
  const posted = await mail.post(ask.from, askLetters.answered(ask));
  recordEvent(caller.project, { kind: "ask.answered", ask: ask.id, by: caller.id, told: waiting ?? null });
  const has = posted === "sent" ? "has it" : "reads it as soon as it can take it";
  const told = waiting ? " Whoever it was waiting on has been told what it was answered with." : "";
  return ok(`Answered ${ask.id}; the asker ${has}.${told}`);
}
