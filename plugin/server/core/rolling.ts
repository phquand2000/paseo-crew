import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

/** An append-only log that rolls into numbered files, packs the older ones and drops the oldest past `keep`. */
export type Rolling = {
  dir: string;
  current: string;
  prefix: string;
  ext: string;
  rotateAt: number;
  keep: number;
  plain: number;
};

const packed = promisify(gzip);
const gone = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function rolledName(roll: Pick<Rolling, "prefix" | "ext">, stamp: string, packedToo = false): string {
  return `${roll.prefix}${stamp}${roll.ext}${packedToo ? ".gz" : ""}`;
}

/** The numbers of the rolled files, oldest first; `complete` leaves out one whose packing was cut short. */
export function rolledStamps(names: string[], roll: Pick<Rolling, "prefix" | "ext">, complete = false): string[] {
  const shape = new RegExp(`^${escape(roll.prefix)}(\\d{8})${escape(roll.ext)}(\\.gz(\\.part)?)?$`);
  const found = new Set<string>();
  for (const name of names) {
    const match = shape.exec(name);
    if (match && !(complete && match[3])) found.add(match[1]!);
  }
  return [...found].sort();
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

function prune(roll: Rolling): void {
  const names = readdirSync(roll.dir);
  const all = rolledStamps(names, roll);
  for (const stamp of all.slice(0, Math.max(0, all.length - roll.keep))) {
    const plain = rolledName(roll, stamp);
    for (const name of [plain, `${plain}.gz`, `${plain}.gz.part`]) if (names.includes(name)) unlinkSync(join(roll.dir, name));
  }
}

/** The newest `plain` rolled files stay readable as text, for a reader that greps across the last roll. */
export function appendRolling(roll: Rolling, line: string): Promise<void> {
  mkdirSync(roll.dir, { recursive: true });
  const file = join(roll.dir, roll.current);
  if (!existsSync(file) || statSync(file).size + Buffer.byteLength(line) <= roll.rotateAt) {
    appendFileSync(file, line);
    return Promise.resolve();
  }
  const last = rolledStamps(readdirSync(roll.dir), roll).at(-1);
  renameSync(file, join(roll.dir, rolledName(roll, String(Number(last ?? 0) + 1).padStart(8, "0"))));
  appendFileSync(file, line);
  prune(roll);
  const names = readdirSync(roll.dir);
  const loose = rolledStamps(names, roll).filter((stamp) => names.includes(rolledName(roll, stamp)));
  return Promise.all(loose.slice(0, Math.max(0, loose.length - roll.plain)).map((stamp) => pack(join(roll.dir, rolledName(roll, stamp))))).then(() => undefined);
}
