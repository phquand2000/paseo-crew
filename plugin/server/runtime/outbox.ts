import type { Seats } from "../core/ports.ts";
import { readJson, writeJson } from "../core/store.ts";

export type Letter = { id: string; to: string; key: string; text: string; at: number };
export type Posted = "sent" | "held" | "duplicate";
export type Compose = (to: string, letters: Letter[]) => string | Promise<string>;
/** Told when a letter is given up on, so that the one thing the desk must not lose is not lost quietly. */
export type Dropped = (letter: Letter, now: number) => void;

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
  private readonly dropped: Dropped | undefined;
  private readonly awaiting = new Map<string, number>();
  private readonly sentKeys = new Map<string, number>();

  /**
   * A duplicate is the same letter to the same reader. Keyed on the key alone, it was also the same
   * key to a *different* reader: every id the desk builds a key from — a lane, a task, an ask — is
   * only unique inside its own project, and this is one file for all of them. So on a daemon holding
   * two projects the second project's Lead was told nothing about its own task, and a seat that came
   * back in place of one that had gone was refused the letter the old seat never read.
   */
  private static held(letter: { to: string; key: string }): string {
    return `${letter.to}\n${letter.key}`;
  }
  private readonly lanes = new Map<string, Promise<unknown>>();
  private counter = 0;

  constructor(file: string, compose: Compose, seats: Seats, dropped?: Dropped) {
    this.file = file;
    this.compose = compose;
    this.seats = seats;
    this.dropped = dropped;
  }

  /**
   * Everything the file holds, including what is about to age out.
   *
   * The age filter used to live here, and both writers rebuild the file from this read — so seven
   * days was not a view, it was a delete, and it happened with nothing written down anywhere. A
   * letter held for a seat that was busy every time the round came round simply stopped existing.
   */
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

  async post(letter: Omit<Letter, "id" | "at">, now = Date.now()): Promise<Posted> {
    const sentAt = this.sentKeys.get(Outbox.held(letter));
    if ((sentAt !== undefined && now - sentAt < DUPLICATE_MS) || this.letters().some((entry) => entry.key === letter.key && entry.to === letter.to)) {
      return "duplicate";
    }
    const stored: Letter = { ...letter, id: `${now}-${process.pid}-${++this.counter}`, at: now };
    this.save([...this.keep(this.letters(), now), stored]);
    const sent = await this.pump(letter.to);
    return sent.has(stored.id) ? "sent" : "held";
  }

  turnEnded(agentId: string): void {
    this.awaiting.delete(agentId);
  }

  archived(agentId: string): void {
    this.awaiting.delete(agentId);
  }

  pending(agentId: string): Letter[] {
    return this.letters().filter((letter) => letter.to === agentId);
  }

  pump(to: string): Promise<Set<string>> {
    return this.lane(to, async () => {
      const mine = this.pending(to);
      if (mine.length === 0) return new Set<string>();
      // A seat Paseo cannot answer for is held, not thrown at the caller: mail is the one thing the
      // desk must not lose, and one unanswerable address must not stop the round for the others.
      // status.md lists what is held and how old it is, which is where a stuck letter surfaces.
      const seat = await this.seats.look(to).catch(() => undefined);
      if (!seat) return new Set<string>();
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
      for (const letter of mine) this.sentKeys.set(Outbox.held(letter), now);
      this.save(this.letters().filter((letter) => !ids.has(letter.id)));
      return ids;
    });
  }
}
