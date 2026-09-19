import { type Kit, can, seatOf } from "../../catalog/kit.ts";
import type { Seen, SeatView, Seats, Stream } from "../../core/ports.ts";
import { Window } from "./window.ts";

export type WatchedSeat = { id: string; provider: string; cwd: string; title?: string | null };

export class SeatWatch {
  readonly seat: WatchedSeat;
  readonly window = new Window();
  running = false;
  turnId: string | null = null;

  constructor(seat: WatchedSeat) {
    this.seat = seat;
  }

  see(seen: Seen): void {
    if (seen.kind === "reset") {
      this.window.clear();
      return;
    }
    if (seen.kind === "turn") {
      this.running = seen.phase === "started";
      this.turnId = seen.turnId;
      if (!this.running) this.window.closeRunning();
      return;
    }
    this.window.add(seen.row);
  }
}

export type WatchDeps = { kit: Kit; seats: Seats; log?: (line: string, error?: unknown) => void };

export class Watches {
  private readonly deps: WatchDeps;
  private readonly followed = new Map<string, { stream: Stream; watch: SeatWatch }>();

  constructor(deps: WatchDeps) {
    this.deps = deps;
  }

  watched(provider: string | null | undefined): boolean {
    return can(seatOf(this.deps.kit, provider)?.role, "watched");
  }

  has(id: string): boolean {
    return this.followed.has(id);
  }

  get(id: string): SeatWatch | undefined {
    return this.followed.get(id)?.watch;
  }

  follow(seat: WatchedSeat): void {
    if (this.followed.has(seat.id) || !this.watched(seat.provider)) return;
    const watch = new SeatWatch(seat);
    let stream: Stream;
    try {
      stream = this.deps.seats.watch(seat.id, (seen) => watch.see(seen));
    } catch (error) {
      this.log(`${seat.id} could not be watched:`, error);
      return;
    }
    const entry = { stream, watch };
    this.followed.set(seat.id, entry);
    stream.ready.catch((error) => {
      if (this.followed.get(seat.id) === entry) this.followed.delete(seat.id);
      this.log(`${seat.id} could not be watched:`, error);
    });
  }

  drop(id: string): void {
    const entry = this.followed.get(id);
    if (!entry) return;
    this.followed.delete(id);
    entry.stream.stop();
  }

  sync(live: Iterable<SeatView>): void {
    const ids = new Set<string>();
    for (const seat of live) {
      if (seat.archivedAt) continue;
      ids.add(seat.id);
      this.follow(seat);
    }
    for (const id of [...this.followed.keys()]) if (!ids.has(id)) this.drop(id);
  }

  dispose(): void {
    for (const id of [...this.followed.keys()]) this.drop(id);
  }

  private log(line: string, error?: unknown): void {
    (this.deps.log ?? ((text, cause) => console.error(`seatworks-v2: ${text}`, cause ?? "")))(line, error);
  }
}
