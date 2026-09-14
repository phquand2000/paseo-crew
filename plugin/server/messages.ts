import type { Ask } from "./asks.ts";

const firstLine = (text: string) => text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
const name = (title: string | null | undefined, id: string) => `"${title ?? "untitled"}" (${id})`;

export const letters = {
  fromLead: (title: string | null, id: string, body: string) => `SEATWORKS from Lead ${name(title, id)}\n\n${body}`,
  handback: (title: string | null, id: string, body: string) => `HANDBACK from ${name(title, id)}\n\n${body}`,
  failed: (title: string | null, id: string, role: string, message: string) =>
    `SEAT FAILED: ${name(title, id)}, a ${role}, ended its turn with an error: ${message}`,
  denied: (title: string | null, id: string, role: string, call: string) =>
    `SEAT STOPPED: ${name(title, id)}, a ${role}, ended its turn right after a refused call (${call}). It is idle until it gets a new instruction.`,
  permission: (title: string | null, id: string, role: string, kind: string, what: string) =>
    `PERMISSION PENDING: ${name(title, id)}, a ${role}, is waiting on a ${kind} request: ${what}.`,
  stalled: (title: string | null, id: string, minutes: number) =>
    `LANE STALLED: Lead ${name(title, id)} has been idle for ${minutes} minutes with no running seat under it and no open request.`,
  reminder: (ask: Ask, minutes: number) =>
    `STILL OPEN after ${minutes} minutes: ${ask.kind} from ${name(ask.title, ask.agentId)}\n${ask.text}`,
  refused: (parentRole: string, childRole: string, allowed: string[]) =>
    `LAUNCH REFUSED: a ${parentRole} may start ${allowed.length > 0 ? allowed.join(", ") : "no seats"}, so the ${childRole} it just started was archived.`,
  openAsks: (asks: Ask[]) =>
    asks.length === 0
      ? ""
      : `Open requests (${asks.length}):\n${asks.map((ask) => `- ${ask.kind} from ${name(ask.title, ask.agentId)}: ${firstLine(ask.text)}`).join("\n")}`,
};
