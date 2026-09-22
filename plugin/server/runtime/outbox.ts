import type { SeatLook, Seats } from "../core/ports.ts";
import { readJson, writeJson } from "../core/store.ts";

export type Letter = { id: string; to: string; key: string; text: string; at: number };
export type Posted = "sent" | "held" | "duplicate";
export type Compose = (to: string, letters: Letter[]) => string | Promise<string>;
/** Told when a letter is given up on, so that the one thing the desk must not lose is not lost quietly. */
export type Dropped = (letter: Letter, now: number) => void;
/** Whether the seat's harness takes a text into a running turn rather than replacing the turn with it. */
export type Steers = (seat: SeatLook) => boolean;

const KEEP_MS = 7 * 24 * 3_600_000;
const DUPLICATE_MS = 30 * 60_000;
const GRACE_MS = 10 * 60_000;
const SETTLE_MS = 60_000;

export function busy(status: string | null | undefined): boolean {
  return status === "running" || status === "initializing";
}

export class Outbox {
  private readonly file: string;
  private readonly compose: Compose;
  private readonly seats: Seats;
  private readonly dropped: Dropped | undefined;
  private readonly steers: Steers;
  private readonly awaiting = new Map<string, number>();
  private readonly started = new Map<string, number>();
  private readonly sentKeys = new Map<string, number>();

  /** Keyed on the reader too: desk ids are unique only per project, and this one file serves them all. */
  private static held(letter: { to: string; key: string }): string {
    return `${letter.to}\n${letter.key}`;
  }
  private readonly lanes = new Map<string, Promise<unknown>>();
  private counter = 0;

  constructor(file: string, compose: Compose, seats: Seats, dropped?: Dropped, steers: Steers = () => false) {
    this.file = file;
    this.compose = compose;
    this.seats = seats;
    this.dropped = dropped;
    this.steers = steers;
  }

  /** Aged-out letters included: both writers rebuild the file from this read, so filtering here deletes. */
  letters(): Letter[] {
    const stored = readJson<Letter[]>(this.file, []);
    return Array.isArray(stored) ? stored.filter((letter) => Boolean(letter) && typeof letter.to === "string" && typeof letter.at === "number") : [];
  }

  /** The one place a letter is given up on, and it says so. */
  private keep(letters: Letter[], now: number): Letter[] {
    const kept: Letter[] = [];
    for (const letter of letters) {
      if (now - letter.at < KEEP_MS) kept.push(letter);
      else this.dropped?.(letter, now);
    }
    return kept;
  }

  private save(letters: Letter[]): void {
    writeJson(this.file, letters);
  }

  private lane<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (this.lanes.get(key) ?? Promise.resolve()).then(run, run);
    this.lanes.set(key, next.catch(() => undefined));
    return next;
  }

  async post(letter: Omit<Letter, "id" | "at">): Promise<Posted> {
    const now = Date.now();
    const sentAt = this.sentKeys.get(Outbox.held(letter));
    // An expired letter is not a pending duplicate; counted as one, it blocked a fresh post.
    if ((sentAt !== undefined && now - sentAt < DUPLICATE_MS) || this.letters().some((entry) => entry.key === letter.key && entry.to === letter.to && now - entry.at < KEEP_MS)) {
      return "duplicate";
    }
    const stored: Letter = { ...letter, id: `${now}-${process.pid}-${++this.counter}`, at: now };
    this.save([...this.keep(this.letters(), now), stored]);
    const sent = await this.pump(letter.to);
    return sent.has(stored.id) ? "sent" : "held";
  }

  turnStarted(agentId: string, now = Date.now()): void {
    this.started.set(agentId, now);
  }

  turnEnded(agentId: string): void {
    this.awaiting.delete(agentId);
    this.started.delete(agentId);
  }

  archived(agentId: string): void {
    this.awaiting.delete(agentId);
    this.started.delete(agentId);
  }

  pending(agentId: string): Letter[] {
    return this.letters().filter((letter) => letter.to === agentId);
  }

  pump(to: string): Promise<Set<string>> {
    return this.lane(to, async () => {
      const mine = this.pending(to);
      if (mine.length === 0) return new Set<string>();
      // Held, not thrown: mail must not be lost, and one unanswerable address must not stop the round.
      const seat = await this.seats.look(to).catch(() => undefined);
      if (!seat) return new Set<string>();
      if (seat.archivedAt) {
        this.archived(to);
        return new Set<string>();
      }
      if ((seat.pendingPermissions?.length ?? 0) > 0) return new Set<string>();
      const since = this.awaiting.get(to);
      const waiting = since !== undefined && Date.now() - since < GRACE_MS;
      // A turn this desk never saw start — one running across a restart — is not known to be settled.
      const began = this.started.get(to);
      const steer = seat.status === "running" && began !== undefined && Date.now() - began >= SETTLE_MS && this.steers(seat);
      if (!steer && (busy(seat.status) || waiting)) return new Set<string>();
      const text = await this.compose(to, mine);
      await this.seats.send(to, text, steer);
      const now = Date.now();
      this.awaiting.set(to, now);
      const ids = new Set(mine.map((letter) => letter.id));
      for (const letter of mine) this.sentKeys.set(Outbox.held(letter), now);
      this.save(this.letters().filter((letter) => !ids.has(letter.id)));
      return ids;
    });
  }
}
