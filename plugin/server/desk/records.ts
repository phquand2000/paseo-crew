import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { appendRolling } from "../core/rolling.ts";
import type { Ledger } from "./ledger.ts";

const DAY = 86_400_000;
export const RECORD_ROTATE_BYTES = 8 * 1024 * 1024;
export const RECORD_KEEP = 12;
export const GATE_LOGS_PER_OWNER = 5;
export const GATE_DAYS = 14;
export const HANDBACK_DAYS = 30;

/** The newest roll stays text, because the retrospective greps a period that may straddle it. */
export function appendRecord(state: string, name: "events" | "attention", line: string): void {
  const roll = { dir: state, current: `${name}.log`, prefix: `${name}.`, ext: ".log", rotateAt: RECORD_ROTATE_BYTES, keep: RECORD_KEEP, plain: 1 };
  appendRolling(roll, line).catch((error: unknown) => console.error(`seatworks-v2: packing a rolled ${name}.log failed:`, error));
}

type Named = { name: string; owner: string; lane: string; at: number };

/** Gate logs are `<lane or task>-<ms>.log`, hand-backs `<task>-<ms>.md`; a task id starts with its lane's. */
function named(dir: string, ext: string): Named[] {
  if (!existsSync(dir)) return [];
  const shape = new RegExp(`^((L\\d+)(?:-[A-Z]\\d+)?)-(\\d+)\\${ext}$`);
  return readdirSync(dir).flatMap((name) => {
    const match = shape.exec(name);
    return match ? [{ name, owner: match[1]!, lane: match[2]!, at: Number(match[3]) }] : [];
  });
}

/**
 * Drops what no agent can still be reading: gate logs past the newest few per task, and gate logs and
 * hand-backs of lanes that are closed or gone once they are old. A hand-back an open lane names is kept.
 */
export function tidyRecords(state: string, ledger: Ledger, now = Date.now()): string[] {
  const open = Object.values(ledger.lanes).filter((lane) => lane.status === "open");
  const isOpen = (lane: string) => open.some((entry) => entry.id === lane);
  const mentioned = open.map((lane) => [lane.title, lane.outcome, ...lane.acceptance].join("\n")).join("\n");
  const dropped: string[] = [];
  const drop = (dir: string, name: string) => {
    unlinkSync(join(dir, name));
    dropped.push(join(dir, name));
  };

  const gates = join(state, "gates");
  const logs = named(gates, ".log").sort((a, b) => b.at - a.at);
  const seen = new Map<string, number>();
  for (const log of logs) {
    const rank = (seen.get(log.owner) ?? 0) + 1;
    seen.set(log.owner, rank);
    if (isOpen(log.lane) ? rank > GATE_LOGS_PER_OWNER : now - log.at > GATE_DAYS * DAY) drop(gates, log.name);
  }

  const handbacks = join(state, "handbacks");
  for (const handback of named(handbacks, ".md")) {
    if (isOpen(handback.lane) || mentioned.includes(handback.name) || now - handback.at <= HANDBACK_DAYS * DAY) continue;
    drop(handbacks, handback.name);
  }
  return dropped;
}
