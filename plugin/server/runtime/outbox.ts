import type { Seats } from "../core/ports.ts";
import { readJson, writeJson } from "../core/store.ts";

export type Letter = { id: string; to: string; key: string; text: string; at: number };
export type Posted = "sent" | "held" | "duplicate";
export type Compose = (to: string, letters: Letter[]) => string | Promise<string>;

const KEEP_MS = 7 * 24 * 3_600_000;
const DUPLICATE_MS = 30 * 60_000;
const GRACE_MS = 10 * 60_000;

export function busy(status: string | null | undefined): boolean {
  return status === "running" || status === "initializing";
}

export class Outbox {
  private readonly file: string;
  private readonly compose: Compose;
  private readonly seats: Seats;
  private readonly awaiting = new Map<string, number>();
  private readonly sentKeys = new Map<string, number>();
  private readonly lanes = new Map<string, Promise<unknown>>();
  private counter = 0;

  constructor(file: string, compose: Compose, seats: Seats) {
    this.file = file;
    this.compose = compose;
    this.seats = seats;
  }

  letters(now = Date.now()): Letter[] {
    const stored = readJson<Letter[]>(this.file, []);
    return Array.isArray(stored) ? stored.filter((letter) => now - letter.at < KEEP_MS) : [];
  }

  private save(letters: Letter[]): void {
    writeJson(this.file, letters);
  }

  private lane<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (this.lanes.get(key) ?? Promise.resolve()).then(run, run);
    this.lanes.set(key, next.catch(() => undefined));
    return next;
  }

  async post(letter: Omit<Letter, "id" | "at">, now = Date.now()): Promise<Posted> {
    const sentAt = this.sentKeys.get(letter.key);
    if ((sentAt !== undefined && now - sentAt < DUPLICATE_MS) || this.letters(now).some((entry) => entry.key === letter.key)) {
      return "duplicate";
    }
    const stored: Letter = { ...letter, id: `${now}-${process.pid}-${++this.counter}`, at: now };
    this.save([...this.letters(now), stored]);
    const sent = await this.pump(letter.to);
    return sent.has(stored.id) ? "sent" : "held";
  }

  turnEnded(agentId: string): void {
    this.awaiting.delete(agentId);
  }

  archived(agentId: string): void {
    this.awaiting.delete(agentId);
    this.save(this.letters().filter((letter) => letter.to !== agentId));
  }

  pending(agentId: string): Letter[] {
    return this.letters().filter((letter) => letter.to === agentId);
  }

  pump(to: string): Promise<Set<string>> {
    return this.lane(to, async () => {
      const mine = this.pending(to);
      if (mine.length === 0) return new Set<string>();
      const seat = await this.seats.look(to);
      if (seat.archivedAt) {
        this.archived(to);
        return new Set<string>();
      }
      const since = this.awaiting.get(to);
      const waiting = since !== undefined && Date.now() - since < GRACE_MS;
      if (busy(seat.status) || (seat.pendingPermissions?.length ?? 0) > 0 || waiting) return new Set<string>();
      const text = await this.compose(to, mine);
      await this.seats.send(to, text);
      const now = Date.now();
      this.awaiting.set(to, now);
      const ids = new Set(mine.map((letter) => letter.id));
      for (const letter of mine) this.sentKeys.set(letter.key, now);
      this.save(this.letters().filter((letter) => !ids.has(letter.id)));
      return ids;
    });
  }
}
