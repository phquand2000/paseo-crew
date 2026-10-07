import type { Lease } from "../../domain/lease.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { DeskBase } from "../base.ts";
import { type Caller, type ToolReply, no, ok } from "../context.ts";
import { leaseLetters } from "../letters/lease-letters.ts";
import type { Project } from "../project/project.ts";
import { recordEvent } from "../store/event-log.ts";
import { readLedger } from "../store/ledger.ts";
import { clock, leaseLine, seatWho } from "../views/lease-lines.ts";

const MINUTE_MS = 60_000;
const DEFAULT_MINUTES = 30;

type Desk = Pick<DeskBase, "ledgers" | "mail">;
type Ended = "cut" | "archived" | "expired";
/** What one write changed: the leases seats lost or stopped waiting for, and those handed on to the next in line. */
type Moved = {
  ended: { resource: string; seat: string; held: boolean }[];
  granted: { resource: string; seat: string; until: number }[];
};

const WHY: Record<Ended, string> = {
  cut: "your work was stopped",
  archived: "its holder is gone",
  expired: "its time ran out",
};

const leasesOf = (ledger: Ledger): Record<string, Lease> => (ledger.leases ??= {});
const waits = (lease: Lease, seat: string) => lease.queue.some((wait) => wait.seat === seat);

function tidy(ledger: Ledger): void {
  if (ledger.leases && Object.keys(ledger.leases).length === 0) delete ledger.leases;
}

/** The holder lets go: the first in line still seated holds it next, for as long as it asked. */
function handOn(ledger: Ledger, resource: string, now: number, moved: Moved): void {
  const leases = leasesOf(ledger);
  const queue = leases[resource]!.queue.filter((wait) => !ledger.agents[wait.seat]?.gone);
  const next = queue.shift();
  if (!next) {
    delete leases[resource];
    return;
  }
  const until = now + next.minutes * MINUTE_MS;
  leases[resource] = { holder: next.seat, since: now, until, queue };
  moved.granted.push({ resource, seat: next.seat, until });
}

/** A seat takes, renews or queues for a lease, or lets it go; the desk keeps it as a record and never enforces it. */
export async function lease(
  desk: Desk,
  caller: Caller,
  args: { resource: string; minutes?: number; release?: boolean },
): Promise<ToolReply> {
  const resource = args.resource.trim().toLowerCase();
  if (!resource || resource.length > 60) return no("Name what you lease in 1 to 60 characters, like staging-db.");
  const { project, id, at } = caller;
  const done = desk.ledgers.transact(project, (ledger) => {
    const moved: Moved = { ended: [], granted: [] };
    const said = args.release
      ? release(ledger, resource, id, at, moved)
      : take(ledger, resource, id, args.minutes ?? DEFAULT_MINUTES, at);
    const line = leaseLine(ledger, resource);
    tidy(ledger);
    return typeof said === "string" ? said : { ...said, line, moved };
  });
  if (typeof done === "string") return no(done);
  if (done.kind === "lease.released") recordEvent(project, { kind: done.kind, resource, seat: id, why: "released" });
  else recordEvent(project, { kind: done.kind, resource, seat: id, ...(done.until ? { until: done.until } : {}) });
  await tell(desk, project, done.moved, "released", at);
  return ok(`${done.text}\nNow: ${done.line}`);
}

type Said = { kind: "lease.taken" | "lease.queued"; text: string; until?: number };
type Let = { kind: "lease.released"; text: string; until?: undefined };

function take(ledger: Ledger, resource: string, seat: string, minutes: number, now: number): Said {
  const leases = leasesOf(ledger);
  const held = leases[resource];
  const until = now + minutes * MINUTE_MS;
  if (!held || held.holder === seat) {
    leases[resource] = { holder: seat, since: held?.since ?? now, until, queue: held?.queue ?? [] };
    const how = held ? "You still hold" : "You hold";
    const text = `${how} ${resource} until ${clock(until)}. Call lease with release true once done; taking it again renews it.`;
    return { kind: "lease.taken", text, until };
  }
  const place = held.queue.findIndex((wait) => wait.seat === seat);
  if (place >= 0) held.queue[place]!.minutes = minutes;
  else held.queue.push({ seat, minutes });
  const number = place >= 0 ? place + 1 : held.queue.length;
  const holder = `${seatWho(ledger, held.holder)} holds ${resource} until ${clock(held.until)}`;
  const text = `${holder}; you are number ${number} in its queue. A LEASE letter tells you when it is yours: meanwhile do what does not need it, or stop.`;
  return { kind: "lease.queued", text };
}

function release(ledger: Ledger, resource: string, seat: string, now: number, moved: Moved): Let | string {
  const held = ledger.leases?.[resource];
  if (held?.holder === seat) {
    handOn(ledger, resource, now, moved);
    return { kind: "lease.released", text: `You let ${resource} go.` };
  }
  if (!held || !waits(held, seat)) return `You neither hold nor wait for ${resource}.`;
  held.queue = held.queue.filter((wait) => wait.seat !== seat);
  return { kind: "lease.released", text: `You no longer wait for ${resource}.` };
}

/** A seat's turn was stopped or it is gone: it holds and waits for nothing from here on. */
export async function leaveLeases(desk: Desk, project: Project, seat: string, why: Ended, now: number): Promise<void> {
  const kept = Object.values(readLedger(project.state).leases ?? {});
  if (!kept.some((held) => held.holder === seat || waits(held, seat))) return;
  const moved = desk.ledgers.transact(project, (ledger) => {
    const moved: Moved = { ended: [], granted: [] };
    for (const [resource, held] of Object.entries(leasesOf(ledger))) {
      if (held.holder === seat) {
        moved.ended.push({ resource, seat, held: true });
        handOn(ledger, resource, now, moved);
      } else if (waits(held, seat)) {
        held.queue = held.queue.filter((wait) => wait.seat !== seat);
        moved.ended.push({ resource, seat, held: false });
      }
    }
    tidy(ledger);
    return moved;
  });
  await tell(desk, project, moved, why, now);
}

/** Leases past their time end, each handed on to the next in line. */
export async function expireLeases(desk: Desk, project: Project, now: number): Promise<void> {
  const kept = Object.values(readLedger(project.state).leases ?? {});
  if (!kept.some((held) => held.until <= now)) return;
  const moved = desk.ledgers.transact(project, (ledger) => {
    const moved: Moved = { ended: [], granted: [] };
    for (const [resource, held] of Object.entries(leasesOf(ledger))) {
      if (held.until > now) continue;
      moved.ended.push({ resource, seat: held.holder, held: true });
      handOn(ledger, resource, now, moved);
    }
    tidy(ledger);
    return moved;
  });
  await tell(desk, project, moved, "expired", now);
}

async function tell(desk: Desk, project: Project, moved: Moved, why: Ended | "released", now: number): Promise<void> {
  for (const end of moved.ended) {
    recordEvent(project, { kind: "lease.released", resource: end.resource, seat: end.seat, why });
    if (why !== "released" && why !== "archived")
      await desk.mail.post(end.seat, leaseLetters.ended(end.resource, WHY[why], end.held, now));
  }
  for (const grant of moved.granted) {
    recordEvent(project, { kind: "lease.granted", resource: grant.resource, seat: grant.seat, until: grant.until });
    await desk.mail.post(grant.seat, leaseLetters.granted(grant.resource, grant.until));
  }
}
