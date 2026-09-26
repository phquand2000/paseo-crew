import type { Seen, Stream, StreamRow } from "./ports.ts";

type Cursor = { epoch: string; seq: number };

export type StreamMessage = {
  event: { type: string; item?: Record<string, unknown>; turnId?: string | null; error?: string; epoch?: string };
  seq?: number;
  epoch?: string;
};

type Entry = { item: Record<string, unknown>; seqStart: number; seqEnd: number; turnId?: string | null };

export type Page = {
  epoch: string;
  entries: Entry[];
  agent?: { activeTurn?: { turnId?: string | null; startedAt?: string | null } | null } | null;
  reset?: boolean;
  staleCursor?: boolean;
  error?: string | null;
};

export type TimelineHandle = {
  subscribe(handler: (message: StreamMessage) => void): (() => void) & { readonly ready: Promise<void> };
  refetch(options: { direction: "tail" | "after"; cursor?: Cursor; limit?: number }): Promise<Page>;
};

type FollowOptions = { readyMs?: number; log?: (line: string, error?: unknown) => void; archived?: () => Promise<boolean> };

const ENDED: Record<string, "completed" | "failed" | "canceled"> = { turn_completed: "completed", turn_failed: "failed", turn_canceled: "canceled" };

const SEED_ROWS = 200;

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** One seat's timeline told once, in order, with what a join, a gap or a reconnect missed read back from history. */
class Follower implements Stream {
  readonly ready: Promise<void>;
  private readonly timeline: TimelineHandle;
  private readonly see: (seen: Seen) => void;
  private readonly log: (line: string, error?: unknown) => void;
  private readonly archived: () => Promise<boolean>;
  private readonly unsubscribe: ReturnType<TimelineHandle["subscribe"]>;
  private readonly early: StreamMessage[] = [];
  private stopped = false;
  private joined = false;
  private epoch: string | undefined;
  private last = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(timeline: TimelineHandle, see: (seen: Seen) => void, options: FollowOptions) {
    const { readyMs = 10_000, log = (line, error) => console.error(`seatworks-v2: ${line}`, error ?? ""), archived = async () => false } = options;
    this.timeline = timeline;
    this.see = see;
    this.log = log;
    this.archived = archived;
    this.unsubscribe = timeline.subscribe((message) => {
      if (this.stopped) return;
      if (this.joined) this.queue(message);
      else this.early.push(message);
    });
    this.ready = this.join(readyMs);
    this.ready.catch(() => this.stop());
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe();
  }

  private async join(readyMs: number): Promise<void> {
    await within(this.unsubscribe.ready, readyMs, "joining a seat's timeline");
    await this.seed();
    this.joined = true;
    for (const message of this.early.splice(0)) this.queue(message);
  }

  private queue(message: StreamMessage): void {
    this.chain = this.chain.then(() => this.handle(message)).catch((error) => this.log("a watched timeline could not be followed:", error));
  }

  private tell(seen: Seen): void {
    if (this.stopped) return;
    try {
      this.see(seen);
    } catch (error) {
      this.log("a watched row could not be read:", error);
    }
  }

  private take(entry: Entry, replay: boolean): void {
    if (!this.epoch || entry.item.type === "plugin") return;
    const row: StreamRow = { item: entry.item, seqStart: entry.seqStart, seq: entry.seqEnd, epoch: this.epoch, turnId: entry.turnId ?? null, replay };
    this.tell({ kind: "row", row });
  }

  /** A page holds whole entries, and one updated late ends past the entries after it, so the cursor moves once a page is read. */
  private read(page: Page, replay: (entry: Entry) => boolean): void {
    for (const entry of page.entries) this.take(entry, replay(entry));
    this.last = Math.max(this.last, ...page.entries.map((entry) => entry.seqEnd));
    if (!page.agent) return;
    const active = page.agent.activeTurn;
    if (!active) return this.tell({ kind: "idle" });
    const at = Date.parse(active.startedAt ?? "");
    this.tell({ kind: "turn", phase: "started", turnId: active.turnId ?? null, ...(Number.isFinite(at) ? { at } : {}) });
  }

  /** Stops once archived: Paseo resumes an archived agent to serve its history and never closes it again. */
  private async gone(): Promise<boolean> {
    if (!this.stopped && (await this.archived())) this.stop();
    return this.stopped;
  }

  private async seed(): Promise<void> {
    if (await this.gone()) return;
    const page = await this.timeline.refetch({ direction: "tail", limit: SEED_ROWS });
    if (page.error) throw new Error(page.error);
    this.epoch = page.epoch;
    this.last = 0;
    const live = new Set(this.early.flatMap((message) => (message.event.type === "timeline" && message.epoch === page.epoch && typeof message.seq === "number" ? [message.seq] : [])));
    this.read(page, (entry) => !entry.turnId || !live.has(entry.seqEnd));
  }

  private async fill(from: number): Promise<void> {
    if (await this.gone()) return;
    const page = await this.timeline.refetch({ direction: "after", cursor: { epoch: this.epoch!, seq: from } });
    if (page.error) throw new Error(page.error);
    if (page.reset || page.staleCursor || page.epoch !== this.epoch) {
      this.tell({ kind: "reset" });
      await this.seed();
      return;
    }
    this.read(page, (entry) => !entry.turnId);
  }

  private async handle(message: StreamMessage): Promise<void> {
    const { event } = message;
    if (event.type === "replacement") {
      this.tell({ kind: "reset" });
      await this.seed();
      return;
    }
    // Paseo sends nothing a reconnect missed, so what happened meanwhile is read back like any gap.
    if (event.type === "subscription_restored") {
      if (this.epoch) await this.fill(this.last);
      return;
    }
    if (event.type === "error") {
      this.tell({ kind: "lost", error: event.error ?? "the subscription failed" });
      this.stop();
      return;
    }
    if (event.type === "turn_started") return this.tell({ kind: "turn", phase: "started", turnId: event.turnId ?? null });
    const ended = ENDED[event.type];
    if (ended) return this.tell({ kind: "turn", phase: ended, turnId: event.turnId ?? null, ...(event.error ? { error: event.error } : {}) });
    if (event.type === "timeline") await this.row(message);
  }

  private async row(message: StreamMessage): Promise<void> {
    const { event, seq, epoch } = message;
    if (typeof seq !== "number" || !epoch) return;
    if (epoch !== this.epoch) {
      this.tell({ kind: "reset" });
      if (seq === 1) {
        this.epoch = epoch;
        this.last = 0;
      } else await this.seed();
    }
    if (seq <= this.last) return;
    if (seq > this.last + 1) await this.fill(this.last);
    if (seq <= this.last) return;
    this.last = seq;
    if (event.item) this.take({ item: event.item, seqStart: seq, seqEnd: seq, turnId: event.turnId }, !event.turnId);
  }
}

export function follow(timeline: TimelineHandle, see: (seen: Seen) => void, options: FollowOptions = {}): Stream {
  return new Follower(timeline, see, options);
}
