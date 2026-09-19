import { type Kit, can, seatOf } from "../catalog/kit.ts";
import { answerWith, questionsIn } from "../core/paseo.ts";
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

  /**
   * A seat stopped on a question reads nothing until it is answered, so a message to it answers it.
   * `waiting` is a seat stopped on something only the Human can decide.
   */
  async answerQuestion(agentId: string, text: string): Promise<"answered" | "waiting" | undefined> {
    let pending;
    try {
      pending = (await this.seats.look(agentId)).pendingPermissions ?? [];
    } catch {
      return undefined;
    }
    const question = pending.find((request) => request.kind === "question" && request.id && questionsIn(request).length > 0);
    if (!question?.id) return pending.length > 0 ? "waiting" : undefined;
    try {
      await this.seats.respond(agentId, question.id, answerWith(question, text));
      return "answered";
    } catch {
      return undefined;
    }
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

  private holds(seat: SeatView, capability: string, project: Project): boolean {
    return can(seatOf(this.kit, seat.provider)?.role, capability) && projectOf(seat.cwd).slug === project.slug;
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
