import type { StreamRow } from "../../core/ports.ts";

export type Detail = {
  type?: string;
  command?: string;
  filePath?: string;
  oldString?: string;
  newString?: string;
  content?: string;
  output?: string;
  exitCode?: number | null;
  [key: string]: unknown;
};

export type Call = {
  id: string;
  name: string;
  status: string;
  detail: Detail;
  error: unknown;
  turnId: string | null;
  seq: number;
  replay: boolean;
  ended: boolean;
};

export type Unit =
  | { kind: "user"; text: string }
  | { kind: "call"; call: Call }
  | { kind: "said"; text: string; messageId?: string }
  | { kind: "thought"; text: string }
  | { kind: "compaction" }
  | { kind: "error"; text: string };

export type Change = { call?: Call; first: boolean; detailed: boolean; settled: boolean };

const TERMINAL = new Set(["completed", "failed", "canceled"]);

function pseudo(item: Record<string, unknown>): boolean {
  const metadata = item.metadata as { synthetic?: unknown } | undefined;
  const detail = item.detail as { type?: unknown } | undefined;
  return metadata?.synthetic === true || (item.name === "terminal" && detail?.type === "plain_text");
}
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export class Window {
  readonly units: Unit[] = [];
  private readonly calls = new Map<string, Call>();
  private readonly limit: number;

  constructor(limit = 80) {
    this.limit = limit;
  }

  add(row: StreamRow): Change {
    const item = row.item;
    const type = text(item.type);
    if (type === "tool_call") return pseudo(item) ? { first: false, detailed: false, settled: false } : this.called(row);
    if (type === "user_message") this.push({ kind: "user", text: text(item.text) });
    else if (type === "assistant_message") this.join("said", text(item.text), text(item.messageId) || undefined);
    else if (type === "reasoning") this.join("thought", text(item.text));
    else if (type === "compaction") this.push({ kind: "compaction" });
    else if (type === "error") this.push({ kind: "error", text: text(item.message) || text(item.text) });
    return { first: false, detailed: false, settled: false };
  }

  closeRunning(): Call[] {
    const closed: Call[] = [];
    for (const call of this.calls.values()) {
      if (call.ended) continue;
      call.ended = true;
      call.status = "canceled";
      closed.push(call);
    }
    return closed;
  }

  clear(): void {
    this.units.length = 0;
    this.calls.clear();
  }

  sinceInstruction(): Unit[] {
    for (let index = this.units.length - 1; index >= 0; index--) if (this.units[index]!.kind === "user") return this.units.slice(index + 1);
    return [...this.units];
  }

  lastInstruction(): string {
    for (let index = this.units.length - 1; index >= 0; index--) {
      const unit = this.units[index]!;
      if (unit.kind === "user") return unit.text;
    }
    return "";
  }

  private called(row: StreamRow): Change {
    const item = row.item;
    const id = text(item.callId) || `seq-${row.seq}`;
    const status = text(item.status) || "running";
    const detail = (item.detail && typeof item.detail === "object" ? item.detail : {}) as Detail;
    const seen = this.calls.get(id);
    if (!seen) {
      const call: Call = {
        id,
        name: text(item.name),
        status,
        detail,
        error: item.error ?? null,
        turnId: row.turnId,
        seq: row.seq,
        replay: row.replay,
        ended: TERMINAL.has(status),
      };
      this.calls.set(id, call);
      this.push({ kind: "call", call });
      return { call, first: true, detailed: detail.type !== undefined && detail.type !== "unknown", settled: call.ended };
    }
    const known = seen.detail.type !== undefined && seen.detail.type !== "unknown";
    const better = detail.type !== undefined && detail.type !== "unknown";
    const detailed = !known && better;
    if (better) seen.detail = { ...seen.detail, ...detail };
    if (seen.ended) return { call: seen, first: false, detailed, settled: false };
    seen.status = status;
    if (status === "failed") seen.error = item.error ?? seen.error;
    const settled = TERMINAL.has(status);
    seen.ended = settled;
    return { call: seen, first: false, detailed, settled };
  }

  private join(kind: "said" | "thought", piece: string, messageId?: string): void {
    if (!piece) return;
    const last = this.units[this.units.length - 1];
    if (last?.kind === kind && (kind === "thought" || (last as { messageId?: string }).messageId === messageId)) {
      last.text += piece;
      return;
    }
    this.push(kind === "said" ? { kind, text: piece, ...(messageId ? { messageId } : {}) } : { kind, text: piece });
  }

  private push(unit: Unit): void {
    this.units.push(unit);
    if (this.units.length <= this.limit) return;
    const dropped = this.units.shift();
    if (dropped?.kind === "call") this.calls.delete(dropped.call.id);
  }
}
