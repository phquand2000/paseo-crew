import { type Kit, can, seatOf } from "../catalog/kit.ts";
import type { SeatLook, SeatView, Seats } from "../core/ports.ts";
import { type Project, projectOf } from "./project.ts";

export class Roster {
  readonly pendingArchive = new Set<string>();
  private readonly kit: Kit;
  private readonly seats: Seats;

  constructor(kit: Kit, seats: Seats) {
    this.kit = kit;
    this.seats = seats;
  }

  open(): Promise<SeatView[]> {
    return this.seats.open();
  }

  look(agentId: string): Promise<SeatLook> {
    return this.seats.look(agentId);
  }

  async supervisorFor(project: Project, preferred?: string): Promise<string | undefined> {
    let gone = false;
    if (preferred) {
      try {
        const seat = await this.seats.look(preferred);
        if (!seat.archivedAt) return preferred;
        gone = true;
      } catch {}
    }
    const found = (await this.seats.open())
      .filter((seat) => this.holds(seat, "supervise", project))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    // Falling back to the preferred id handed back the very seat this method had just read as
    // archived, and every letter to it was held for an address nobody will ever read. `undefined` is
    // the answer callers already have a path for: nobody is seated to be told.
    return found[0]?.id ?? (gone ? undefined : preferred);
  }

  watcherSeat(project: Project, seats: Iterable<SeatView>): string | undefined {
    return this.seatThatCan(project, seats, "watch");
  }

  supervisorSeat(project: Project, seats: Iterable<SeatView>): string | undefined {
    return this.seatThatCan(project, seats, "supervise");
  }

  /** Every seat on this project that can do the thing. Several may supervise it, each for its own concern. */
  seatsThatCan(project: Project, seats: Iterable<SeatView>, capability: string): SeatView[] {
    return [...seats].filter((seat) => this.holds(seat, capability, project));
  }

  private seatThatCan(project: Project, seats: Iterable<SeatView>, capability: string): string | undefined {
    return this.seatsThatCan(project, seats, capability)[0]?.id;
  }

  private holds(seat: SeatView, capability: string, project: Project): boolean {
    return can(seatOf(this.kit, seat.provider)?.role, capability) && projectOf(seat.cwd).slug === project.slug;
  }

  /** `now` is for an owner switching watching off: an instruction, rather than the work running out. */
  async retireWatcher(project: Project, known?: Iterable<SeatView>, now = false): Promise<void> {
    // Materialised because callers hand over a Map iterator, and this reads the seats twice.
    const seats = [...(known ?? (await this.seats.open()))];
    if (!now && this.supervisorSeat(project, seats)) return;
    const seated = this.watcherSeat(project, seats);
    if (seated) await this.archive(seated);
  }

  async archive(agentId: string | undefined, force = false): Promise<void> {
    if (!agentId) return;
    try {
      if (!force) {
        const seat = await this.seats.look(agentId);
        if (seat.status === "running" || seat.status === "initializing") {
          this.pendingArchive.add(agentId);
          return;
        }
      }
      this.pendingArchive.delete(agentId);
      await this.seats.archive(agentId);
    } catch (error) {
      console.error(`seatworks-v2: archiving ${agentId} failed:`, error);
    }
  }
}
