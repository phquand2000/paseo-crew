import type { Ledger } from "../../domain/ledger.ts";

/** A time of day on the machine's clock, as seats and the Human read it. */
export const clock = (at: number): string => new Date(at).toTimeString().slice(0, 5);

/** A seat as the desk names it to others: its role, and the task or lane it is bound to. */
export function seatWho(ledger: Ledger, id: string): string {
  const bound = ledger.agents[id];
  const work = bound?.task ?? bound?.lane;
  return `${bound?.role ?? "agent"} ${id}${work ? ` (${work})` : ""}`;
}

/** One lease: who holds it until when, and who waits for it in order. */
export function leaseLine(ledger: Ledger, resource: string): string {
  const lease = ledger.leases?.[resource];
  if (!lease) return `${resource}: free`;
  const queue = lease.queue.map((wait) => seatWho(ledger, wait.seat)).join(", ");
  const held = `${resource}: ${seatWho(ledger, lease.holder)} since ${clock(lease.since)} until ${clock(lease.until)}`;
  return `${held}; waiting: ${queue || "nobody"}`;
}

export function leaseLines(ledger: Ledger): string[] {
  const names = Object.keys(ledger.leases ?? {}).sort();
  if (names.length === 0) return [];
  return ["## Leases", "", ...names.map((name) => `- ${leaseLine(ledger, name)}`), ""];
}
