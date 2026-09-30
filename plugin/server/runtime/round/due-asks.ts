import type { Kit } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import type { SeatView } from "../../core/ports.ts";
import { oneLine } from "../../core/text.ts";
import type { Desk } from "../../desk/desk.ts";
import { askLetters } from "../../desk/letters/ask-letters.ts";
import type { Project } from "../../desk/project/project.ts";
import { loadIncidents, openFor, saidBefore } from "../../desk/store/incidents.ts";
import type { Ask } from "../../domain/ask.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, carriedOf } from "../../domain/ledger.ts";
import type { TeamSource } from "../team-source.ts";
import { fact } from "../watch/fact-kinds.ts";
import { decide } from "../watch/findings.ts";

type AskDeps = { kit: Kit; desk: Desk; source: TeamSource };

/** An open ask whose reader is gone goes to whoever supervises now; one left waiting is a fact about its reader for the watch, never a reminder on a clock. */
export async function dueAsks(
  deps: AskDeps,
  project: Project,
  ledger: Ledger,
  seats: Map<string, SeatView>,
  now: number,
  missingOf: (ids: string[]) => Promise<Set<string>>,
): Promise<void> {
  const { askWaitingMinutes } = deps.source.teamFor(project).attention;
  const open = Object.values(ledger.asks).filter((entry) => entry.status === "open");
  const missing = await missingOf(open.filter((ask) => !seats.has(ask.to)).map((ask) => ask.to));
  const waiting = new Map<string, Ask[]>();
  for (const ask of open) {
    const lane = ask.lane ? ledger.lanes[ask.lane] : undefined;
    if (missing.has(ask.to)) await moveAsk(deps, project, ask, lane, now);
    // Carried up, it waits on the ask or Human question above, which stands for it.
    else if (ask.carriedBy && (ledger.asks[ask.carriedBy] ?? ledger.questions[ask.carriedBy])?.status === "open")
      continue;
    else if (now - (ask.movedAt ?? ask.openedAt) >= askWaitingMinutes * 60_000)
      waiting.set(ask.to, [...(waiting.get(ask.to) ?? []), ask]);
  }
  await waitedOn(deps, project, seats, waiting);
}

/** One fact per reader, naming every ask that waits on it: sighted again while open and untold, never once settled. */
async function waitedOn(
  { kit, desk }: AskDeps,
  project: Project,
  seats: Map<string, SeatView>,
  waiting: Map<string, Ask[]>,
): Promise<void> {
  if (waiting.size === 0) return;
  const book = loadIncidents(project.state);
  for (const [reader, asks] of waiting) {
    const seat = seats.get(reader);
    // The watch tells only whoever supervises, and never about itself.
    if (!seat || seat.archivedAt || can(seatOf(kit, seat.provider)?.role, "supervise")) continue;
    const quote = asks
      .map((ask) => `${ask.id} (${ask.kind}) from ${ask.task ?? ask.lane ?? ask.from}: ${oneLine(ask.text, 160)}`)
      .join("; ");
    const found = fact("ask-waiting", quote);
    const standing = openFor(book, reader, found.kind);
    if (!standing && saidBefore(book, reader, found.kind, quote)) continue;
    if (standing && standing.quote === quote && standing.told !== undefined) continue;
    await desk.notice(project, { id: reader, provider: seat.provider, title: seat.title }, decide([found]));
  }
}

/** An ask whose reader has gone goes to whoever supervises now, a Lead's own ask included. */
async function moveAsk(
  { desk }: AskDeps,
  project: Project,
  ask: Ask,
  lane: Lane | undefined,
  now: number,
): Promise<void> {
  const to = await desk.supervisorFor(project, lane?.opener);
  if (!to || to === ask.to) return;
  const moved = desk.transact(project, (current) => {
    const entry = current.asks[ask.id];
    if (!entry || entry.status !== "open" || entry.to !== ask.to) return undefined;
    entry.to = to;
    entry.movedAt = now;
    return { entry: { ...entry }, carried: carriedOf(current, entry.id).map((id) => ({ ...current.asks[id]! })) };
  });
  const from = ask.task
    ? `the Peer on ${ask.task}, whose reader is gone`
    : `the Lead of ${ask.lane ?? "a lane"}, whose reader is gone`;
  if (moved) await desk.post(to, askLetters.askTo(moved.entry, from, "supervisor", moved.carried));
}
