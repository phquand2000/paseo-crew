import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzip } from "node:zlib";

export type Kept = {
  at: number;
  askedAt: number;
  seat: string;
  provider: string;
  turnId: string | null;
  running: boolean;
  sensor: string;
  model: string;
  id: string | null;
  cost: number | null;
  questions: Record<string, { instructions: string; criteria?: { true: string; false: string } }>;
  answers: Record<string, number>;
  facts: { kind: string; level: string; quote: string }[];
  found: string[];
  verdicts: { kind: string; question: string; says: string; p: number }[];
  state: Record<string, unknown>;
};

export const ROTATE_BYTES = 32 * 1024 * 1024;
export const KEEP_FILES = 64;

/** The file every reading is appended to, until it is rotated away. */
export const KEPT_FILE = "current.jsonl";
const ROTATED = /^(\d{8})\.jsonl(\.gz(\.part)?)?$/;
const packed = promisify(gzip);

export function assessmentsDir(state: string): string {
  return join(state, "assessments");
}

const gone = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/**
 * Minutes since the watch last kept a reading here, or undefined if it never has.
 *
 * One `stat`, because the alternative is parsing a file that runs to megabytes on every poll of a
 * screen. The question it answers is the one a screen is really asking — has this thing ever run
 * here, and how long ago — not how many times.
 */
export function lastKept(state: string, now = Date.now()): number | undefined {
  try {
    return Math.max(0, Math.round((now - statSync(join(assessmentsDir(state), KEPT_FILE)).mtimeMs) / 60_000));
  } catch {
    return undefined;
  }
}

async function pack(plain: string): Promise<void> {
  let data: Buffer;
  try {
    data = await readFile(plain);
  } catch (error) {
    if (gone(error)) return;
    throw error;
  }
  try {
    await writeFile(`${plain}.gz.part`, await packed(data));
    await rename(`${plain}.gz.part`, `${plain}.gz`);
  } catch (error) {
    await unlink(`${plain}.gz.part`).catch(() => undefined);
    throw error;
  }
  await unlink(plain).catch((error: unknown) => {
    if (!gone(error)) throw error;
  });
}

function stamps(names: string[], complete = false): string[] {
  const found = new Set<string>();
  for (const name of names) {
    const match = ROTATED.exec(name);
    if (match && !(complete && match[3])) found.add(match[1]!);
  }
  return [...found].sort();
}

function prune(dir: string, keep: number): void {
  const names = readdirSync(dir);
  const all = stamps(names);
  for (const stamp of all.slice(0, Math.max(0, all.length - keep))) {
    for (const name of [`${stamp}.jsonl`, `${stamp}.jsonl.gz`, `${stamp}.jsonl.gz.part`]) if (names.includes(name)) unlinkSync(join(dir, name));
  }
}

export function keepAssessment(state: string, kept: Kept, rotateAt = ROTATE_BYTES, keep = KEEP_FILES): Promise<void> {
  const dir = assessmentsDir(state);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, KEPT_FILE);
  const line = `${JSON.stringify(kept)}\n`;
  let rotated: string | undefined;
  if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > rotateAt) {
    const last = stamps(readdirSync(dir)).at(-1);
    rotated = join(dir, `${String(Number(last ?? 0) + 1).padStart(8, "0")}.jsonl`);
    renameSync(file, rotated);
  }
  appendFileSync(file, line);
  if (!rotated) return Promise.resolve();
  prune(dir, keep);
  return pack(rotated);
}

export type Tally = { turns: number; cost: number };

const tallyOf = (text: string): Tally => {
  let turns = 0;
  let cost = 0;
  for (const row of text.split("\n")) {
    if (!row.trim()) continue;
    try {
      const kept = JSON.parse(row) as { cost?: unknown };
      turns += 1;
      if (typeof kept.cost === "number") cost += kept.cost;
    } catch {}
  }
  return { turns, cost };
};

/** Per assessments directory: how far into the current file has been counted, and each rotated file once. */
const counted = new Map<string, { ino: number; offset: number; current: Tally; rotated: Map<string, Tally> }>();

/**
 * Every reading the watch has kept for a project, and what they cost — the whole project, not the
 * seats that happen to be running.
 *
 * The screen asks every few seconds and the file runs to megabytes, so it is never read twice: a
 * rotated file does not change, and is counted once; the current one is read from where the last
 * count stopped, up to its last whole line. A rotation is seen as a new file under the old name,
 * and the one it replaced turns up as a rotated file, so nothing is counted twice or lost.
 */
export function readTally(state: string): Tally {
  const dir = assessmentsDir(state);
  if (!existsSync(dir)) {
    counted.delete(dir);
    return { turns: 0, cost: 0 };
  }
  let seen = counted.get(dir);
  if (!seen) {
    seen = { ino: -1, offset: 0, current: { turns: 0, cost: 0 }, rotated: new Map() };
    counted.set(dir, seen);
  }
  const names = readdirSync(dir);
  const live = new Set(stamps(names, true));
  for (const stamp of [...seen.rotated.keys()]) if (!live.has(stamp)) seen.rotated.delete(stamp);
  for (const stamp of live) {
    if (seen.rotated.has(stamp)) continue;
    try {
      const text = names.includes(`${stamp}.jsonl.gz`) ? gunzipSync(readFileSync(join(dir, `${stamp}.jsonl.gz`))).toString("utf-8") : readFileSync(join(dir, `${stamp}.jsonl`), "utf-8");
      seen.rotated.set(stamp, tallyOf(text));
    } catch {
      // Being packed at this moment; it is counted on the next look.
    }
  }
  try {
    const file = join(dir, KEPT_FILE);
    const { ino, size } = statSync(file);
    if (ino !== seen.ino || size < seen.offset) Object.assign(seen, { ino, offset: 0, current: { turns: 0, cost: 0 } });
    if (size > seen.offset) {
      const chunk = Buffer.alloc(size - seen.offset);
      const fd = openSync(file, "r");
      try {
        readSync(fd, chunk, 0, chunk.length, seen.offset);
      } finally {
        closeSync(fd);
      }
      // Up to the last whole line: a reading being appended right now is counted next time.
      const end = chunk.lastIndexOf(0x0a) + 1;
      const more = tallyOf(chunk.subarray(0, end).toString("utf-8"));
      seen.offset += end;
      seen.current = { turns: seen.current.turns + more.turns, cost: seen.current.cost + more.cost };
    }
  } catch {
    Object.assign(seen, { ino: -1, offset: 0, current: { turns: 0, cost: 0 } });
  }
  let turns = seen.current.turns;
  let cost = seen.current.cost;
  for (const tally of seen.rotated.values()) {
    turns += tally.turns;
    cost += tally.cost;
  }
  return { turns, cost };
}

export function readAssessments(state: string): { kept: Kept[]; broken: number } {
  const dir = assessmentsDir(state);
  if (!existsSync(dir)) return { kept: [], broken: 0 };
  const names = readdirSync(dir);
  const kept: Kept[] = [];
  let broken = 0;
  const texts: string[] = [];
  for (const stamp of stamps(names, true)) {
    const zipped = () => gunzipSync(readFileSync(join(dir, `${stamp}.jsonl.gz`))).toString("utf-8");
    try {
      texts.push(names.includes(`${stamp}.jsonl.gz`) ? zipped() : readFileSync(join(dir, `${stamp}.jsonl`), "utf-8"));
    } catch {
      try {
        texts.push(zipped());
      } catch {
        broken += 1;
      }
    }
  }
  if (names.includes(KEPT_FILE)) texts.push(readFileSync(join(dir, KEPT_FILE), "utf-8"));
  for (const text of texts) {
    for (const row of text.split("\n")) {
      if (!row.trim()) continue;
      try {
        kept.push(JSON.parse(row) as Kept);
      } catch {
        broken += 1;
      }
    }
  }
  return { kept: kept.sort((a, b) => a.at - b.at), broken };
}
