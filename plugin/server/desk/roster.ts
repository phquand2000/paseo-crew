import { type Kit, seatOf } from "../catalog/kit.ts";
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
    if (preferred) {
      try {
        const seat = await this.seats.look(preferred);
        if (!seat.archivedAt) return preferred;
      } catch {}
    }
    const found = (await this.seats.open())
      .filter((seat) => seatOf(this.kit, seat.provider)?.role.team === "supervisor" && projectOf(seat.cwd).slug === project.slug)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return found[0]?.id ?? preferred;
  }

  watcherSeat(project: Project, seats: Iterable<SeatView>): string | undefined {
    return this.seatOfTeam(project, seats, "watcher");
  }

  supervisorSeat(project: Project, seats: Iterable<SeatView>): string | undefined {
    return this.seatOfTeam(project, seats, "supervisor");
  }

  private seatOfTeam(project: Project, seats: Iterable<SeatView>, team: string): string | undefined {
    for (const seat of seats) if (seatOf(this.kit, seat.provider)?.role.team === team && projectOf(seat.cwd).slug === project.slug) return seat.id;
    return undefined;
  }

  async retireWatcher(project: Project, known?: Iterable<SeatView>): Promise<void> {
    const seats = known ?? (await this.seats.open());
    if (this.supervisorSeat(project, seats)) return;
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
