import type { Page, StreamMessage, TimelineHandle } from "../../server/core/stream.ts";

type Row = { item: Record<string, unknown>; seq: number; turnId: string | null };
type Entry = {
  item: Record<string, unknown>;
  seqStart: number;
  seqEnd: number;
  sources: number[];
  turnId: string | null;
};

const ENDS = new Set(["turn_completed", "turn_failed", "turn_canceled"]);

const known = (detail: unknown) => detail !== undefined && (detail as { type?: string }).type !== "unknown";

/** Paseo 0.9 folds a tool call's updates into the call and a run of text chunks into one message (`timeline-projection.ts`). */
function project(rows: Row[]): Entry[] {
  const entries: Entry[] = [];
  const calls = new Map<string, Entry>();
  for (const row of rows) {
    const { item } = row;
    const call = item.type === "tool_call" ? calls.get(String(item.callId)) : undefined;
    if (call && call.turnId === row.turnId) {
      const detail =
        item.detail === undefined || (!known(item.detail) && known(call.item.detail)) ? call.item.detail : item.detail;
      Object.assign(call, {
        item: { ...call.item, ...item, detail },
        seqEnd: Math.max(call.seqEnd, row.seq),
        sources: [...call.sources, row.seq],
      });
      continue;
    }
    const previous = entries.at(-1);
    const text = item.type === "assistant_message" || item.type === "reasoning";
    const sameMessage =
      item.type !== "assistant_message" || item.messageId === undefined || item.messageId === previous?.item.messageId;
    if (
      text &&
      previous &&
      previous.item.type === item.type &&
      previous.seqEnd + 1 === row.seq &&
      previous.turnId === row.turnId &&
      sameMessage
    ) {
      Object.assign(previous, {
        item: { ...previous.item, text: `${String(previous.item.text)}${String(item.text)}` },
        seqEnd: row.seq,
        sources: [...previous.sources, row.seq],
      });
      continue;
    }
    const entry = { item, seqStart: row.seq, seqEnd: row.seq, sources: [row.seq], turnId: row.turnId };
    if (item.type === "tool_call") calls.set(String(item.callId), entry);
    entries.push(entry);
  }
  return entries;
}

/** The tail keeps earlier entries whose updates land inside it, as `selectProjectedEntriesTail` does; no limit is everything. */
function tail(entries: Entry[], limit: number): Entry[] {
  let start = limit === 0 ? 0 : Math.max(0, entries.length - limit);
  for (let index = start - 1; index >= 0; index--)
    if (entries[index]!.seqEnd >= entries[start]!.seqStart) start = index;
  return entries.slice(start);
}

export class FakeTimeline implements TimelineHandle {
  epoch = "epoch-1";
  rows: Row[] = [];
  activeTurn: { turnId: string | null; startedAt: string } | null = null;
  listeners = new Set<(message: StreamMessage) => void>();
  subscriptions = 0;
  fetches: { direction: string; from?: number }[] = [];
  ready: Promise<void> = Promise.resolve();
  private epochs = 1;

  subscribe(handler: (message: StreamMessage) => void) {
    this.subscriptions += 1;
    this.listeners.add(handler);
    const off = () => {
      this.listeners.delete(handler);
    };
    return Object.assign(off, { ready: this.ready });
  }

  /** A stale cursor gets the tail, and an `after` page every entry with a source row past the cursor, whole. */
  async refetch(options: {
    direction: "tail" | "after";
    cursor?: { epoch: string; seq: number };
    limit?: number;
  }): Promise<Page> {
    this.fetches.push({ direction: options.direction, from: options.cursor?.seq });
    const stale = options.cursor !== undefined && options.cursor.epoch !== this.epoch;
    const entries = project(this.rows);
    const from = options.cursor?.seq ?? 0;
    const page =
      options.direction === "tail" || stale
        ? tail(entries, options.limit ?? 200)
        : entries.filter((entry) => entry.sources.some((seq) => seq > from));
    return {
      epoch: this.epoch,
      entries: page.map(({ item, seqStart, seqEnd, turnId }) => ({ item, seqStart, seqEnd, turnId })),
      agent: { activeTurn: this.activeTurn },
      reset: stale,
      staleCursor: stale,
      error: null,
    };
  }

  add(item: Record<string, unknown>, turnId: string | null = "turn-1", quiet = false): number {
    const seq = (this.rows.at(-1)?.seq ?? 0) + 1;
    this.rows.push({ item, seq, turnId });
    if (!quiet) this.send({ event: { type: "timeline", item, turnId }, seq, epoch: this.epoch });
    return seq;
  }

  beat(type: string, turnId: string | null = "turn-1", error?: string, quiet = false): void {
    if (type === "turn_started") this.activeTurn = { turnId, startedAt: new Date().toISOString() };
    if (ENDS.has(type)) this.activeTurn = null;
    if (!quiet) this.send({ event: { type, turnId, ...(error ? { error } : {}) } });
  }

  rewind(keep: number): void {
    this.rows = this.rows.slice(0, keep);
    this.epoch = `epoch-${++this.epochs}`;
    this.rows = this.rows.map((row, index) => ({ ...row, seq: index + 1 }));
    this.send({ event: { type: "replacement", epoch: this.epoch } });
  }

  /** What the SDK tells a subscription once its socket is back: nothing it missed comes with it. */
  restore(): void {
    this.send({ event: { type: "subscription_restored" } });
  }

  /** The SDK reports a failed subscription once, then releases it. */
  fail(error: string): void {
    this.send({ event: { type: "error", error } });
    this.listeners.clear();
  }

  send(message: StreamMessage): void {
    for (const listener of [...this.listeners]) listener(message);
  }
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
