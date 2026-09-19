import type { Page, StreamMessage, TimelineHandle } from "../../server/core/stream.ts";

type Row = { item: Record<string, unknown>; seq: number; turnId: string | null };

export class FakeTimeline implements TimelineHandle {
  epoch = "epoch-1";
  rows: Row[] = [];
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

  async refetch(options: { direction: "tail" | "after"; cursor?: { epoch: string; seq: number }; limit?: number }): Promise<Page> {
    this.fetches.push({ direction: options.direction, from: options.cursor?.seq });
    const stale = options.cursor !== undefined && options.cursor.epoch !== this.epoch;
    let rows = this.rows;
    if (options.direction === "tail") rows = rows.slice(-(options.limit ?? 200));
    else if (!stale) rows = rows.filter((row) => row.seq > (options.cursor?.seq ?? 0));
    return {
      epoch: this.epoch,
      entries: rows.map((row) => ({ item: row.item, seqStart: row.seq, seqEnd: row.seq, turnId: row.turnId })),
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

  beat(type: string, turnId: string | null = "turn-1", error?: string): void {
    this.send({ event: { type, turnId, ...(error ? { error } : {}) } });
  }

  rewind(keep: number): void {
    this.rows = this.rows.slice(0, keep);
    this.epoch = `epoch-${++this.epochs}`;
    this.rows = this.rows.map((row, index) => ({ ...row, seq: index + 1 }));
    this.send({ event: { type: "replacement", epoch: this.epoch } });
  }

  reload(): void {
    const history = this.rows;
    this.epoch = `epoch-${++this.epochs}`;
    this.rows = [];
    for (const row of history) this.add(row.item, null);
  }

  send(message: StreamMessage): void {
    for (const listener of [...this.listeners]) listener(message);
  }
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
