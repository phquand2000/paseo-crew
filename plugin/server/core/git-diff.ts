import { git } from "./git.ts";

export type Counts = { src: number; test: number; docs: number; files: string[] };

/** Which paths are tests and which are docs, as the ecosystem the kit holds names them. */
export type FileKinds = { test: RegExp; docs: RegExp };

export function kindOf(path: string, kinds: FileKinds): "src" | "test" | "docs" {
  if (kinds.test.test(path)) return "test";
  return kinds.docs.test(path) ? "docs" : "src";
}

/**
 * Reads `-z` output, so a rename yields both real paths, not the `src/{old.ts => new.ts}` form that matches no path a write set
 * or hold names. Lines of an `uncounted` path are left out of the counts; the path is still listed.
 */
function countNumstat(numstat: string, kinds: FileKinds, uncounted: (path: string) => boolean = () => false): Counts {
  const counts: Counts = { src: 0, test: 0, docs: 0, files: [] };
  const fields = numstat.split("\0");
  for (let index = 0; index < fields.length; index++) {
    const row = fields[index];
    if (!row?.trim()) continue;
    const [added, removed, inline] = row.split("\t");
    const lines = (Number(added) || 0) + (Number(removed) || 0);
    const paths: string[] = [];
    if (inline?.trim()) paths.push(inline.trim());
    else {
      // A rename or a copy: the two paths follow as their own fields.
      const from = fields[index + 1];
      const to = fields[index + 2];
      if (from) paths.push(from);
      if (to) paths.push(to);
      index += 2;
    }
    for (const path of paths) {
      if (!uncounted(path)) counts[kindOf(path, kinds)] += lines;
      counts.files.push(path);
    }
  }
  return counts;
}

/** Undefined when git could not answer: zeroed counts read as "nothing changed", which is a claim. */
export async function diffCounts(
  cwd: string,
  from: string,
  to: string,
  kinds: FileKinds,
  uncounted?: (path: string) => boolean,
): Promise<Counts | undefined> {
  const run = await git(cwd, ["diff", "-z", "--numstat", `${from}..${to}`]);
  return run.code === 0 ? countNumstat(run.stdout, kinds, uncounted) : undefined;
}

/** The files changed across `range`, as git diff reads it, or undefined when git cannot say. */
export async function changedFiles(cwd: string, range: string): Promise<string[] | undefined> {
  const run = await git(cwd, ["diff", "-z", "--name-only", range]);
  return run.code === 0 ? run.stdout.split("\0").filter(Boolean) : undefined;
}
