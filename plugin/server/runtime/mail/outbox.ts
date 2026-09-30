import { KeyedQueue } from "../../core/keyed-queue.ts";
import { midTurn } from "../../core/paseo.ts";
import type { SeatLook, Seats } from "../../core/ports.ts";
import { isRecord } from "../../core/json.ts";
import { daemonLog } from "../../core/logger.ts";
import { keptFault, readKept, writeJson } from "../../core/store.ts";

export type Letter = { id: string; to: string; key: string; text: string; at: number; wakes?: false };
type Posted = "sent" | "held" | "duplicate";

const isLetter = (value: unknown): value is Letter =>
  isRecord(value) && typeof value.to === "string" && typeof value.at === "number";
type Compose = (to: string, letters: Letter[]) => string | Promise<string>;
/**
 * What the outbox asks of the desk. `dropped` is told when a letter is given up on, so it is not lost quietly; `holding`,
 * whether its mail waits for a hold to lift; `quietBefore`, when the seat gave back the work its earlier mail was about,
 * which no longer wakes it.
 */
export type Rules = {
  dropped?: (letter: Letter, now: number) => void;
  holding?: (seat: SeatLook) => boolean;
  quietBefore?: (seat: SeatLook) => number | undefined;
};

const KEEP_MS = 7 * 24 * 3_600_000;
const DUPLICATE_MS = 30 * 60_000;
const GRACE_MS = 10 * 60_000;

export class Outbox {
  private readonly file: string;
  private readonly compose: Compose;
  private readonly seats: Pick<Seats, "look" | "send">;
  private readonly rules: Rules;
  private readonly awaiting = new Map<string, number>();
  private readonly sentKeys = new Map<string, number>();

  /** Keyed on the reader too: desk ids are unique only per project, and this one file serves them all. */
  private static held(letter: { to: string; key: string }): string {
    return `${letter.to}\n${letter.key}`;
  }
  private readonly perSeat = new KeyedQueue();
  private counter = 0;

  constructor(file: string, compose: Compose, seats: Pick<Seats, "look" | "send">, rules: Rules = {}) {
    this.file = file;
    this.compose = compose;
    this.seats = seats;
    this.rules = rules;
  }

  /** Aged-out letters included, as both writers rebuild the file from this read; one that cannot be read throws, not empties. */
  letters(): Letter[] {
    const read = readKept<unknown[]>(this.file, [], Array.isArray);
    if ("fault" in read) throw keptFault(read.fault);
    return read.value.filter(isLetter);
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

  async post(letter: Omit<Letter, "id" | "at">): Promise<Posted> {
    const now = Date.now();
    const sentAt = this.sentKeys.get(Outbox.held(letter));
    const waiting = this.letters();
    // An expired letter is not a pending duplicate; counted as one, it blocked a fresh post.
    if (
      (sentAt !== undefined && now - sentAt < DUPLICATE_MS) ||
      waiting.some((entry) => entry.key === letter.key && entry.to === letter.to && now - entry.at < KEEP_MS)
    ) {
      return "duplicate";
    }
    const stored: Letter = { ...letter, id: `${now}-${process.pid}-${++this.counter}`, at: now };
    this.save([...this.keep(waiting, now), stored]);
    const sent = await this.pump(letter.to);
    return sent.has(stored.id) ? "sent" : "held";
  }

  turnEnded(agentId: string): void {
    this.forget(agentId);
  }

  archived(agentId: string): void {
    this.forget(agentId);
  }

  private forget(agentId: string): void {
    this.awaiting.delete(agentId);
  }

  /** Every letter not yet sent, with when it is given up on: nothing else is sent a gone seat's mail. */
  held(): (Letter & { until: number })[] {
    return this.letters().map((letter) => ({ ...letter, until: letter.at + KEEP_MS }));
  }

  /** A letter not yet sent is dropped once what it asked is settled before its reader got it; false when none was held. */
  withdraw(key: string): Promise<boolean> {
    const to = this.letters().find((letter) => letter.key === key)?.to;
    if (to === undefined) return Promise.resolve(false);
    return this.perSeat.run(to, async () => {
      const letters = this.letters();
      const kept = letters.filter((letter) => letter.to !== to || letter.key !== key);
      if (kept.length < letters.length) this.save(kept);
      return kept.length < letters.length;
    });
  }

  pending(agentId: string): Letter[] {
    return this.letters().filter((letter) => letter.to === agentId);
  }

  /** The seat, when it is there to be sent mail: not archived. */
  private async reachable(to: string): Promise<SeatLook | undefined> {
    // Held, not thrown: mail must not be lost, and one unanswerable address must not stop the round.
    const seat = await this.seats.look(to).catch(() => undefined);
    if (!seat?.archivedAt) return seat;
    this.archived(to);
    return undefined;
  }

  /**
   * Everything held for a seat, as one text for the reply to a call of its own: read inside its turn with no send to
   * replace that turn, so word that asks nothing goes too. Held as a pump holds it, and kept once the reply is not `wanted`.
   */
  take(to: string, wanted: () => boolean = () => true): Promise<string | undefined> {
    return this.perSeat.run(to, async () => {
      const mine = this.pending(to);
      const seat = mine.length > 0 ? await this.reachable(to) : undefined;
      if (!seat || (seat.pendingPermissions?.length ?? 0) > 0 || this.rules.holding?.(seat)) return undefined;
      const text = await this.compose(to, mine);
      if (!wanted()) return undefined;
      this.sent(mine, Date.now());
      return text;
    });
  }

  pump(to: string): Promise<Set<string>> {
    return this.perSeat.run(to, async () => {
      const mine = this.pending(to);
      const seat = mine.length > 0 ? await this.reachable(to) : undefined;
      if (!seat) return new Set<string>();
      if ((seat.pendingPermissions?.length ?? 0) > 0) return new Set<string>();
      if (this.rules.holding?.(seat)) return new Set<string>();
      const since = this.awaiting.get(to);
      const waiting = since !== undefined && Date.now() - since < GRACE_MS;
      // Never into a turn under way: a seat cut into while it thinks or writes loses the thought, and letters steered in
      // one by one scatter it. Its queue waits for the turn's end, or rides the reply to its next desk call.
      if (midTurn(seat.status) || waiting) return new Set<string>();
      const quiet = this.rules.quietBefore?.(seat);
      // Word that asks nothing of an idle seat now waits for a letter that does.
      if (!mine.some((letter) => letter.wakes !== false && (quiet === undefined || letter.at >= quiet)))
        return new Set<string>();
      const text = await this.compose(to, mine);
      const kinds = [...new Set(mine.map((letter) => letter.key.split(":")[0]!))];
      try {
        await this.seats.send(to, text, kinds);
      } catch (error) {
        // Kept for the next pump: what posted it has already happened, and a retry would do it twice.
        daemonLog.error(`mail for ${to} was not taken:`, error);
        return new Set<string>();
      }
      this.awaiting.set(to, Date.now());
      return this.sent(mine, Date.now());
    });
  }

  /** Letters that reached their seat leave the file, and a second post of one soon after is the same letter. */
  private sent(letters: Letter[], now: number): Set<string> {
    const ids = new Set(letters.map((letter) => letter.id));
    for (const [key, at] of this.sentKeys) if (now - at >= DUPLICATE_MS) this.sentKeys.delete(key);
    for (const letter of letters) this.sentKeys.set(Outbox.held(letter), now);
    this.save(this.letters().filter((letter) => !ids.has(letter.id)));
    return ids;
  }
}
