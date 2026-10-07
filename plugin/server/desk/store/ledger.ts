import { statSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../core/json.ts";
import { STATE_VERSION } from "../../core/state-version.ts";
import { readJsonFile, writeJson } from "../../core/store.ts";
import type { Lane } from "../../domain/lane.ts";
import { type Ledger, emptyLedger, taskOfPeer } from "../../domain/ledger.ts";
import { AT_WORK } from "../../domain/task.ts";

function ledgerFile(state: string): string {
  return join(state, "ledger.json");
}

/** A ledger missing a part is not one: read as empty, its numbering would give ids out again. */
const isLedger = (value: unknown): value is Ledger =>
  isRecord(value) &&
  isRecord(value.seq) &&
  Number.isInteger(value.seq.lane) &&
  Number.isInteger(value.seq.ask) &&
  Object.keys(emptyLedger()).every((part) => part === "seq" || isRecord(value[part]));

function stateFault(file: string, value: unknown): string | undefined {
  const format = isRecord(value) ? value.format : undefined;
  if (format === STATE_VERSION) return undefined;
  if (typeof format === "number" && format > STATE_VERSION)
    return `${file} is at state ${format}, made by a newer Paseo Crew than this one, which reads ${STATE_VERSION}`;
  return `${file} is at state ${JSON.stringify(format)} and this plugin reads ${STATE_VERSION}: its upgrade at the plugin's start did not go through, and Migrate says why`;
}

/** The ledger on disk from one read, or why it cannot be read: parsed as nothing, the next write would erase the project. */
export function readLedgerFile(state: string): { ledger: Ledger } | { fault: string } {
  const file = ledgerFile(state);
  const read = readJsonFile(file);
  if ("fault" in read) return read;
  if ("absent" in read) return { ledger: emptyLedger() };
  const fault =
    stateFault(file, read.value) ??
    (isLedger(read.value) ? undefined : `${file} does not hold what the plugin keeps there`);
  return fault ? { fault } : { ledger: read.value as Ledger };
}

/** The ledger, or throws why it cannot be read: never an empty one standing in for a file that is there. Absent is empty. */
export function loadLedger(state: string): Ledger {
  const read = readLedgerFile(state);
  if ("fault" in read)
    throw new Error(
      `${read.fault}. Nothing was read from it as if the project had no work on record. Only the Human can repair it or move it aside; no agent may write the plugin's own files.`,
    );
  return read.ledger;
}

export function saveLedger(state: string, ledger: Ledger): void {
  cached.delete(state);
  writeJson(ledgerFile(state), { ...ledger, format: STATE_VERSION });
}

const cached = new Map<string, { mtimeMs: number; size: number; ledger: Ledger }>();

export function readLedger(state: string): Ledger {
  let stamp: { mtimeMs: number; size: number };
  try {
    stamp = statSync(ledgerFile(state));
  } catch (error) {
    cached.delete(state);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger();
    // Only absence is empty: anything else throws, as reading it does.
    return loadLedger(state);
  }
  const hit = cached.get(state);
  if (hit && hit.mtimeMs === stamp.mtimeMs && hit.size === stamp.size) return hit.ledger;
  const ledger = loadLedger(state);
  cached.set(state, { mtimeMs: stamp.mtimeMs, size: stamp.size, ledger });
  return ledger;
}

function readable(state: string): Ledger | undefined {
  try {
    return loadLedger(state);
  } catch {
    return undefined;
  }
}

/** The lane on hold that this seat works in, as its Lead, a Peer or a reviewer; none where the ledger cannot be read. */
export function laneOnHold(state: string, agentId: string): Lane | undefined {
  const ledger = readable(state);
  const lane = ledger?.lanes[ledger.agents[agentId]?.lane ?? ""];
  return lane?.onHold && lane.status !== "closed" ? lane : undefined;
}

/** When this Peer handed its task back, unless it was sent back to work since; none where the ledger cannot be read. */
export function handedBackAt(state: string, agentId: string): number | undefined {
  const ledger = readable(state);
  const task = ledger && taskOfPeer(ledger, agentId);
  return task?.handback && !AT_WORK.includes(task.status) ? task.handback.at : undefined;
}
