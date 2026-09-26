import type { Kit } from "../../catalog/kit/kit.ts";
import { can, seatOf } from "../../catalog/kit/roles.ts";
import { midTurn } from "../../core/paseo.ts";
import type { SeatLook, SeatView, Seats, StreamRow } from "../../core/ports.ts";
import type { Intents } from "../store/intents.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Project, projectOf } from "../project/project.ts";
import { daemonLog } from "../../core/logger.ts";

export class Roster {
  private readonly kit: Kit;
  private readonly seats: Seats;
  private readonly intents: Intents;

  constructor(kit: Kit, seats: Seats, intents: Intents) {
    this.kit = kit;
    this.seats = seats;
    this.intents = intents;
  }

  open(): Promise<SeatView[]> {
    return this.seats.open();
  }

  /** Whether a seat is still there to read what is sent to it. */
  async seated(agentId: string): Promise<boolean> {
    try {
      return !(await this.look(agentId)).archivedAt;
    } catch {
      return false;
    }
  }

  look(agentId: string): Promise<SeatLook> {
    return this.seats.look(agentId);
  }

  /** Who reads what is meant for a lane's Lead: the Lead while it is seated, else whoever supervises, who can seat one. */
  async readerOf(
    project: Project,
    lane: Lane | undefined,
  ): Promise<{ to: string | undefined; as: "lead" | "supervisor" }> {
    if (lane?.lead && (await this.seated(lane.lead))) return { to: lane.lead, as: "lead" };
    return { to: await this.supervisorFor(project, lane?.opener), as: "supervisor" };
  }

  /** Sends past the outbox, cutting a running turn short; a seat that is gone is left so, since a send would start it again. */
  async interrupt(agentId: string, letter: { key: string; text: string }): Promise<boolean> {
    if (!(await this.seated(agentId))) return false;
    await this.seats.send(agentId, letter.text, [letter.key.split(":")[0]!], "interrupt");
    return true;
  }

  history(agentId: string, limit: number): Promise<StreamRow[]> {
    return this.seats.history(agentId, limit);
  }

  async supervisorFor(project: Project, preferred?: string): Promise<string | undefined> {
    let gone = false;
    if (preferred) {
      try {
        const seat = await this.seats.look(preferred);
        if (!seat.archivedAt) return preferred;
        gone = true;
      } catch {
        // Paseo could not say: the preferred seat is not taken for gone.
      }
    }
    // Not the preferred id: it may be the seat just read as archived, and every letter to it would be held forever.
    return (await this.holderOf(project, "supervise")) ?? (gone ? undefined : preferred);
  }

  /** The project's open seat, the one heard from last, whose role can `capability`. */
  async holderOf(project: Project, capability: string): Promise<string | undefined> {
    const found = (await this.seats.open())
      .filter((seat) => this.holds(seat, capability, project))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return found[0]?.id;
  }

  private holds(seat: SeatView, capability: string, project: Project): boolean {
    return can(seatOf(this.kit, seat.provider)?.role, capability) && projectOf(seat.cwd).slug === project.slug;
  }

  /** Whether the seat is archived once its turn ends. */
  archiving(agentId: string): boolean {
    return this.intents.toArchive().includes(agentId);
  }

  async archive(agentId: string | undefined, force = false): Promise<void> {
    if (!agentId) return;
    try {
      if (!force && midTurn((await this.seats.look(agentId)).status)) {
        this.intents.archiveLater(agentId);
        return;
      }
      this.intents.archived(agentId);
      await this.seats.archive(agentId);
    } catch (error) {
      daemonLog.error(`archiving ${agentId} failed:`, error);
    }
  }

  /** After a stop: a seat left to end its turn goes now if the listing shows that turn over, and is forgotten if it is gone. */
  async archiveWaiting(listed: Map<string, SeatView>): Promise<void> {
    for (const id of this.intents.toArchive()) {
      const seat = listed.get(id);
      if (!seat) this.intents.archived(id);
      else if (!midTurn(seat.status)) await this.archive(id);
    }
  }
}
