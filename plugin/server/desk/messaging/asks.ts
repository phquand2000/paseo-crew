import { can, roleNamed } from "../../catalog/kit/roles.ts";
import { ASK } from "../../domain/ask.ts";
import { SETTLED } from "../../domain/task.ts";
import { askLetters } from "../letters/ask-letters.ts";
import { type Caller, type Posted, type ToolReply, no, ok } from "../context.ts";
import { repeatsIncident } from "../store/incidents.ts";
import type { Ask } from "../../domain/ask.ts";
import { type Ledger, carriedOf, laneOfLead, nextAskId, taskOfPeer } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import type { DeskEvent } from "../store/events.ts";

type Asking = Pick<Ask, "from" | "fromRole" | "to" | "lane" | "task" | "kind" | "text" | "default">;

/** A new open ask, numbered in `ledger`. */
function newAsk(ledger: Ledger, asking: Asking): Ask {
  return { id: nextAskId(ledger), ...asking, status: "open", openedAt: Date.now() };
}

const opened = (ask: Ask): DeskEvent => ({
  kind: "ask.opened",
  ask: ask.id,
  from: ask.from,
  to: ask.to,
  fromRole: ask.fromRole,
  askKind: ask.kind,
  withDefault: Boolean(ask.default),
});

/** A Lead asks whoever supervises its lane, and works on its default while it waits; a Peer's ask it carries waits on it. */
export async function askOwner(
  { ledgers, mail, roster }: Pick<DeskServices, "ledgers" | "mail" | "roster">,
  caller: Caller,
  asked: { kind: string; text: string; default: string; carries?: string[] },
): Promise<ToolReply> {
  const { project } = caller;
  const lane = laneOfLead(loadLedger(project.state), caller.id);
  if (!lane) return no("You have no open lane.");
  const to = await roster.supervisorFor(project, lane.opener);
  if (!to)
    return no("Nobody above you is running to answer; keep working on your default and report when the lane is ready.");
  const ids = [...new Set((asked.carries ?? []).map((id) => id.toUpperCase()))];
  // Opened on the lane the caller still leads: it may have closed while whoever answers was looked up.
  const result = ledgers.transact(project, (ledger) => {
    if (laneOfLead(ledger, caller.id)?.id !== lane.id) return "You have no open lane.";
    const stray = ids.find((id) => !carriable(ledger.asks[id], caller.id, lane.id));
    if (stray) return `${stray} is not a Peer's open ask put to you on ${lane.id}.`;
    const from = { from: caller.id, fromRole: caller.role.role, to, lane: lane.id };
    const created = newAsk(ledger, { ...from, kind: asked.kind, text: asked.text, default: asked.default });
    ledger.asks[created.id] = created;
    const carried = ids.map((id) => Object.assign(ledger.asks[id]!, { carriedBy: created.id }));
    return { entry: { ...created }, carried: carried.map((ask) => ({ ...ask })) };
  });
  if (typeof result === "string") return no(result);
  const { entry, carried } = result;
  await mail.post(to, askLetters.askTo(entry, `the Lead of ${lane.id} (${lane.title})`, "supervisor", carried));
  for (const ask of carried) await mail.post(ask.from, askLetters.carried(ask, entry.id));
  recordEvent(project, opened(entry));
  if (carried.length === 0)
    return ok(`Asked as ${entry.id}. Keep working on your default where you can; the answer arrives as mail.`);
  const names = carried.map((ask) => ask.id).join(", ");
  return ok(
    `Asked as ${entry.id}, carrying ${names}. Leave ${names} open: its Peer waits on it without being nudged, and you answer it from ${entry.id}'s answer.`,
  );
}

/** A Peer's ask a Lead may carry up: open, put to that Lead, on its lane. */
const carriable = (ask: Ask | undefined, lead: string, lane: string): boolean =>
  Boolean(ask?.task) && ask?.status === "open" && ask.to === lead && ask.lane === lane;

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
  recordEvent(project, opened(entry));
  const owner = to === lane.lead ? "" : ", of the owner, because your lead is not there";
  return ok(`Asked as ${entry.id}${owner}. End your turn; the answer arrives as a message.`);
}

/** Answers an open ask; one put to someone else may be answered by whoever supervises, and that seat is told first, as is the Lead of a Peer answered past it. */
export async function answerAsk(
  desk: Pick<DeskServices, "kit" | "ledgers" | "mail" | "roster">,
  caller: Caller,
  answered: { ask: string; text: string; keepsDefault?: boolean },
): Promise<ToolReply> {
  const id = answered.ask.toUpperCase();
  const { text } = answered;
  const refused = repeatsIncident(caller.project.state, loadLedger(caller.project.state).asks[id]?.from, text);
  if (refused) return no(refused);
  const result = desk.ledgers.transact(caller.project, (ledger): Answered | string => {
    const ask = ledger.asks[id];
    if (!ask) return `There is no ask ${id}.`;
    if (!ASK.may(ask.status, "answer")) return `Ask ${id} is already answered.`;
    if (ask.to !== caller.id && !can(caller.role, "supervise")) return `Ask ${id} was not addressed to you.`;
    if (ask.default && answered.keepsDefault === undefined)
      return `${id} came with a default (${ask.default}): say with keepsDefault whether your answer keeps it.`;
    ASK.move(ask, "answer");
    ask.answer = text;
    ask.answeredAt = Date.now();
    if (ask.default) ask.kept = answered.keepsDefault;
    const lane = ask.lane ? ledger.lanes[ask.lane] : undefined;
    const carried = carriedOf(ledger, ask.id);
    return {
      ask: { ...ask },
      waitingRole: ledger.agents[ask.to]?.role,
      opener: lane?.opener,
      lead: lane?.lead,
      carried,
    };
  });
  if (typeof result === "string") return no(result);
  const { ask } = result;
  const waiting = ask.to === caller.id ? undefined : ask.to;
  const { posted, lead } = await tellAround(desk, caller, result, waiting);
  recordEvent(caller.project, {
    kind: "ask.answered",
    ask: ask.id,
    by: caller.id,
    told: waiting ?? lead ?? null,
    kept: ask.kept ?? null,
  });
  const has = posted === "sent" ? "has it" : "reads it as soon as it can take it";
  const told = waiting ? " Whoever it was waiting on has been told what it was answered with." : "";
  const led = lead ? " Its lane's Lead has been told what it was answered with." : "";
  return ok(`Answered ${ask.id}; the asker ${has}.${told}${led}`);
}

type Answered = { ask: Ask; waitingRole?: string; opener?: string; lead?: string; carried: string[] };

/** The asker gets the answer; the seat it waited on is told first, and whoever supervises sees a default overruled below them. */
async function tellAround(
  { kit, mail, roster }: Pick<DeskServices, "kit" | "mail" | "roster">,
  caller: Caller,
  { ask, waitingRole, opener, lead, carried }: Answered,
  waiting: string | undefined,
): Promise<{ posted: Posted | "nobody"; lead?: string }> {
  // Answering an ask put to someone else is allowed, but that seat is told first.
  if (waiting) {
    const role = roleNamed(kit, waitingRole ?? "");
    const by = can(role, "supervise") ? `${caller.role.label} ${caller.id}` : "the owner";
    await mail.post(waiting, askLetters.answeredFor(ask, by, can(role, "lead")));
  }
  const passed = await leadPassed(roster, caller, ask, lead === waiting ? undefined : lead);
  if (passed) await mail.post(passed, askLetters.answeredFor(ask, "the owner", true, false));
  const posted = await mail.post(ask.from, askLetters.answered(ask, carried));
  if (ask.kept === false && !can(caller.role, "supervise")) {
    const above = await roster.supervisorFor(caller.project, opener);
    if (above) await mail.post(above, askLetters.overruled(ask));
  }
  return { posted, lead: passed };
}

/** The seated Lead of a Peer's lane that whoever supervises answered past: the one reach past a Lead is never out of its sight. */
async function leadPassed(
  roster: Pick<DeskServices["roster"], "seated">,
  caller: Caller,
  ask: Ask,
  lead: string | undefined,
): Promise<string | undefined> {
  if (!ask.task || !lead || lead === caller.id || !can(caller.role, "supervise")) return undefined;
  return (await roster.seated(lead)) ? lead : undefined;
}
