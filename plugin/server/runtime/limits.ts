import type { RoleSpec } from "../catalog/kit/kit.ts";
import { can } from "../catalog/kit/roles.ts";
import type { Team } from "../catalog/team/team.ts";
import type { SeatView } from "../core/ports.ts";
import { nextTimeOfDay } from "../core/time.ts";
import type { Desk } from "../desk/desk.ts";
import { seatLetters } from "../desk/letters/seat-letters.ts";
import type { Project } from "../desk/project/project.ts";
import { readLedger } from "../desk/store/ledger.ts";
import type { Ledger } from "../domain/ledger.ts";

/** Past the reset the agent gave, so a clock a little behind does not stop it on the same limit. */
const WAKE_MARGIN_MS = 5 * 60_000;

/** When the desk wakes a seat whose limit resets as the agent said, or undefined when that cannot be read. */
export function wakeTime(resets: string | null, now: number): number | undefined {
  const at = resets ? nextTimeOfDay(resets, now) : undefined;
  return at === undefined ? undefined : Math.max(at, now) + WAKE_MARGIN_MS;
}

/** Marks the seat limited until `wakeAt`; returns when its spell began, only on the turn that began it. */
export function markLimited(
  desk: Pick<Desk, "transact">,
  project: Project,
  seat: { id: string; role: string },
  wakeAt: number | undefined,
  now: number,
): number | undefined {
  return desk.transact(project, (ledger) => {
    const ref = ledger.agents[seat.id] ?? { ...seat };
    const since = ref.limited?.since;
    ref.limited = wakeAt === undefined ? { since: since ?? now } : { since: since ?? now, wakeAt };
    ledger.agents[seat.id] = ref;
    return since === undefined ? now : undefined;
  });
}

/** A turn that ends on anything but the limit ends the spell. */
export function clearLimited(desk: Pick<Desk, "transact">, project: Project, agentId: string): void {
  if (!readLedger(project.state).agents[agentId]?.limited) return;
  desk.transact(project, (ledger) => {
    const ref = ledger.agents[agentId];
    if (ref) delete ref.limited;
  });
}

/** The roles on another agent that hold every capability the limited seat's role holds, as the Human knows them. */
export function meanwhileRoles(team: Team, role: RoleSpec, harness: string): string[] {
  return Object.values(team.roles)
    .filter((seat) => seat.harness.id !== harness && (role.can ?? []).every((power) => can(seat.role, power)))
    .map((seat) => `${seat.role.label} (${seat.harness.label})`);
}

/** A seat whose limit has reset is told to continue; one the round did not list waits for a round that does. */
export async function wakeLimited(
  desk: Pick<Desk, "transact" | "post">,
  project: Project,
  ledger: Ledger,
  seats: Map<string, SeatView>,
  now: number,
): Promise<void> {
  for (const ref of Object.values(ledger.agents)) {
    const wakeAt = ref.limited?.wakeAt;
    if (wakeAt === undefined || wakeAt > now || !seats.has(ref.id)) continue;
    const due = desk.transact(project, (current) => {
      const limited = current.agents[ref.id]?.limited;
      if (limited?.wakeAt !== wakeAt) return false;
      delete limited.wakeAt;
      return true;
    });
    if (due) await desk.post(ref.id, seatLetters.limitReset(wakeAt));
  }
}
