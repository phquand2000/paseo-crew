export const SERIAL_ONLY = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "Cargo.lock",
  "go.sum",
  "**/migrations/**",
  "**/db/migrate/**",
  "ProjectSettings/**",
  "Packages/manifest.json",
  "**/*.unity",
  "**/*.prefab",
  "**/*.asset",
  "**/*.uasset",
  "**/*.umap",
  "**/*.pbxproj",
  "**/*.csproj",
  "**/*.sln",
];

export function normalize(pattern: string): string {
  return pattern.trim().replace(/^\.\//, "").replace(/\/+$/, "/");
}

export function literalPrefix(pattern: string): string {
  const clean = normalize(pattern);
  const index = clean.search(/[*?[{]/);
  return index < 0 ? clean : clean.slice(0, index);
}

export function globToRegex(pattern: string): RegExp {
  let out = "";
  const clean = normalize(pattern);
  for (let index = 0; index < clean.length; index++) {
    const char = clean[index]!;
    if (char === "*") {
      if (clean[index + 1] === "*") {
        index++;
        // `**/` stands for whole segments or none of them. Rendered as `.*` with the separator
        // swallowed, it matched any segment merely ending in the next name: `**/migrations/**` put
        // `server/db_migrations/` in the project's serial-only set, and two lanes that never touch a
        // migration were told they overlap. `patternsOverlap` walks segments and never agreed.
        if (clean[index + 1] === "/") {
          out += "(?:.*/)?";
          index++;
        } else out += ".*";
      } else out += "[^/]*";
    } else if (char === "?") out += "[^/]";
    else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  if (clean.endsWith("/")) out += ".*";
  return new RegExp(`^${out}$`);
}

function samplePath(pattern: string): string {
  return normalize(pattern).replace(/\*\*\/?/g, "x/").replace(/\*/g, "x").replace(/\?/g, "x").replace(/\/$/, "/x");
}

/**
 * Can one path segment satisfy both of these segment globs?
 *
 * Sampling one against a made-up witness of the other fails here for the same reason it failed for
 * whole paths: `*.ts` and `app.*` are both satisfied by `app.ts`, and neither matches a sample of
 * the other. Only `*` and `?` occur inside a segment — `globToRegex` escapes the rest — so the two
 * are walked together, `*` standing for any run of characters that is not a slash and `?` for one.
 * A state reached twice cannot be reached a third way with a different answer, so it is not retried.
 */
function segmentsMeet(a: string, b: string): boolean {
  if (a === b || a === "*" || b === "*") return true;
  const seen = new Set<number>();
  const stars = (rest: string) => [...rest].every((char) => char === "*");
  const walk = (i: number, j: number): boolean => {
    const state = i * (b.length + 1) + j;
    if (seen.has(state)) return false;
    seen.add(state);
    if (i === a.length) return stars(b.slice(j));
    if (j === b.length) return stars(a.slice(i));
    const left = a[i]!;
    const right = b[j]!;
    if (left === "*") return walk(i + 1, j) || walk(i, j + 1);
    if (right === "*") return walk(i, j + 1) || walk(i + 1, j);
    if (left === "?" || right === "?") return walk(i + 1, j + 1);
    return left === right && walk(i + 1, j + 1);
  };
  return walk(0, 0);
}

/**
 * Whether any one path could match both patterns.
 *
 * Walked segment by segment, because testing one pattern against a single synthetic sample of the
 * other misses every case where both sides hold a wildcard: `src/**\/*.ts` and `**\/*.test.ts` both
 * match `src/pricing.test.ts`, and a sample of either matches neither. Two lanes are allowed to
 * share a working copy on the strength of this answer, so a missed overlap lets both write one file.
 */
function meet(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) {
    // What is left can still match nothing only if every segment of it is allowed to. A trailing ""
    // comes from a directory pattern and stands for everything under it; "**" spans zero segments.
    const rest = a.length === 0 ? b : a;
    return rest.every((segment) => segment === "**" || segment === "");
  }
  const [ax, ...at] = a;
  const [bx, ...bt] = b;
  if (ax === "" || bx === "") return true;
  // "**" spans any number of segments, including none, on either side.
  if (ax === "**") return meet(at, b) || meet(a, bt) || meet(at, bt);
  if (bx === "**") return meet(a, bt) || meet(at, b) || meet(at, bt);
  return segmentsMeet(ax!, bx!) && meet(at, bt);
}

export function patternsOverlap(a: string, b: string): boolean {
  return meet(normalize(a).split("/"), normalize(b).split("/"));
}

export function firstOverlap(left: string[], right: string[]): string | undefined {
  for (const a of left) for (const b of right) if (patternsOverlap(a, b)) return a === b ? a : `${a} and ${b}`;
  return undefined;
}

/**
 * The serial-only paths a repository really has.
 *
 * A rule is a glob and so is a write set, and of two globs it can only be said that they *might*
 * meet: every lane claiming a subtree might hold a lock file or a migration somewhere under it.
 * Refusing on might leaves a project stuck on one lane, so the rules are resolved against the files
 * that exist and the write set is compared against real paths. A rule that reserves a whole
 * directory yields the directory, so the next migration — which nobody has written yet — counts.
 */
export function serialPaths(tracked: string[], serialOnly: string[]): string[] {
  const found = new Set<string>();
  for (const rule of serialOnly) {
    const matches = globToRegex(rule);
    const reservesDir = normalize(rule).endsWith("**");
    for (const file of tracked) {
      if (!matches.test(file)) continue;
      const cut = file.lastIndexOf("/");
      found.add(reservesDir && cut > 0 ? file.slice(0, cut + 1) : file);
    }
  }
  return [...found].sort();
}

/** Which of those paths a write set could reach, to compare one lane's reach against another's. */
export function serialReach(writeSet: string[], serial: string[]): string[] {
  return serial.filter((path) => writeSet.some((pattern) => patternsOverlap(pattern, path)));
}

/** Which of the write set's own patterns land on one, so a refusal can quote the seat's own words. */
export function serialHits(writeSet: string[], serial: string[]): string[] {
  return writeSet.filter((pattern) => serial.some((path) => patternsOverlap(pattern, path)));
}
