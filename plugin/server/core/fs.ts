import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Something that is not a link stands where one should go: it is left alone, since deleting it would lose what it holds. */
export class LeftAlone extends Error {}

export function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Whether anything is at `path`, a dangling link included. */
export function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Points `path` at `target`; false when it already did. Throws LeftAlone over anything else at `path`. */
export function ensureLink(path: string, target: string): boolean {
  if (isLink(path)) {
    if (readlinkSync(path) === target) return false;
    unlinkSync(path);
  } else if (present(path)) {
    throw new LeftAlone(`${path} exists and is not a link, so it was left alone`);
  }
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
  return true;
}

/** Writes `text` as a real file, replacing a link there; false when the file already held it. */
export function writeIfChanged(path: string, text: string): boolean {
  if (isLink(path)) unlinkSync(path);
  if (present(path) && readFileSync(path, "utf-8") === text) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return true;
}

/** A short hash of every file under each source, in order: the same content hashes the same wherever it lies. */
export function digest(sources: string[]): string {
  const hash = createHash("sha256");
  for (const [index, source] of sources.entries()) {
    if (!existsSync(source)) continue;
    const files = statSync(source).isDirectory()
      ? readdirSync(source, { recursive: true })
          .map(String)
          .filter((file) => statSync(join(source, file)).isFile())
          .sort()
      : [""];
    for (const file of files)
      hash
        .update(`${index}/${file}\0`)
        .update(readFileSync(join(source, file)))
        .update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}
