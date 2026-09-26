import { midTurn } from "../core/paseo.ts";
import type { SeatLook, Seats } from "../core/ports.ts";
import { readJson, writeJson } from "../core/store.ts";

export type Letter = { id: string; to: string; key: string; text: string; at: number; wakes?: false };
type Posted = "sent" | "held" | "duplicate";
type Compose = (to: string, letters: Letter[]) => string | Promise<string>;
/**
 * What the outbox asks of the desk. `dropped` is told when a letter is given up on, so it is not lost quietly; `steers`, whether
 * the seat's harness takes a text into a running turn rather than replacing the turn; `calling`, whether the seat waits on a
 * call to the desk, where a text steered in reads as the call cut short; `holding`, whether its mail waits for a hold to lift.
 */
export type Rules = {
  dropped?: (letter: Letter, now: number) => void;
  steers?: (seat: SeatLook) => boolean;
  calling?: (agentId: string) => boolean;
  holding?: (seat: SeatLook) => boolean;
};

const KEEP_MS = 7 * 24 * 3_600_000;
const DUPLICATE_MS = 30 * 60_000;
const GRACE_MS = 10 * 60_000;
const SETTLE_MS = 60_000;

export class Outbox {
  private readonly file: string;
  private readonly compose: Compose;
  private readonly seats: Pick<Seats, "look" | "send">;
  private readonly rules: Rules;
  private readonly awaiting = new Map<string, number>();
  private readonly started = new Map<string, number>();
  private readonly sentKeys = new Map<string, number>();

  /** Keyed on the reader too: desk ids are unique only per project, and this one file serves them all. */
  private static held(letter: { to: string; key: string }): string {
    return `${letter.to}\n${letter.key}`;
  }
  private readonly lanes = new Map<string, Promise<unknown>>();
  private counter = 0;

  constructor(file: string, compose: Compose, seats: Pick<Seats, "look" | "send">, rules: Rules = {}) {
    this.file = file;
    this.compose = compose;
    this.seats = seats;
    this.rules = rules;
  }

  /** Aged-out letters included: both writers rebuild the file from this read, so filtering here deletes. */
  letters(): Letter[] {
    const stored = readJson<Letter[]>(this.file, []);
    return Array.isArray(stored)
      ? stored.filter((letter) => Boolean(letter) && typeof letter.to === "string" && typeof letter.at === "number")
      : [];
  }

  /** The one place a letter is given up on, and it says so. */
  private keep(letters: Letter[], now: number): Letter[] {
    const kept: Letter[] = [];
    for (const letter of letters) {
      if (now - letter.at < KEEP_MS) kept.push(letter);
      else this.rules.dropped?.(letter, now);
    }
    return kept;
  }

  private save(letters: Letter[]): void {
    writeJson(this.file, letters);
  }

  private lane<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (this.lanes.get(key) ?? Promise.resolve()).then(run, run);
    this.lanes.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  async post(letter: Omit<Letter, "id" | "at">): Promise<Posted> {
    const now = Date.now();
    const sentAt = this.sentKeys.get(Outbox.held(letter));
    // An expired letter is not a pending duplicate; counted as one, it blocked a fresh post.
    if (
      (sentAt !== undefined && now - sentAt < DUPLICATE_MS) ||
      this.letters().some((entry) => entry.key === letter.key && entry.to === letter.to && now - entry.at < KEEP_MS)
    ) {
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

  /** Every letter not yet sent, with when it is given up on: nothing else is sent a gone seat's mail. */
  held(): (Letter & { until: number })[] {
    return this.letters().map((letter) => ({ ...letter, until: letter.at + KEEP_MS }));
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
      if (this.rules.holding?.(seat)) return new Set<string>();
      const since = this.awaiting.get(to);
      const waiting = since !== undefined && Date.now() - since < GRACE_MS;
      // A turn this desk never saw start — one running across a restart — is not known to be settled.
      const began = this.started.get(to);
      const steer =
        seat.status === "running" &&
        began !== undefined &&
        Date.now() - began >= SETTLE_MS &&
        this.rules.steers?.(seat) === true &&
        this.rules.calling?.(to) !== true;
      if (!steer && (midTurn(seat.status) || waiting)) return new Set<string>();
      // Word that asks nothing of an idle seat now waits for a letter that does, or for a turn it is already in.
      if (!steer && mine.every((letter) => letter.wakes === false)) return new Set<string>();
      const text = await this.compose(to, mine);
      await this.seats.send(
        to,
        text,
        [...new Set(mine.map((letter) => letter.key.split(":")[0]!))],
        steer ? "steer" : undefined,
      );
      const now = Date.now();
      this.awaiting.set(to, now);
      const ids = new Set(mine.map((letter) => letter.id));
      for (const letter of mine) this.sentKeys.set(Outbox.held(letter), now);
      this.save(this.letters().filter((letter) => !ids.has(letter.id)));
      return ids;
    });
  }
}
