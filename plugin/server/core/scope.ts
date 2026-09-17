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
        out += ".*";
        index++;
        if (clean[index + 1] === "/") index++;
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

export function patternsOverlap(a: string, b: string): boolean {
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  if (pa !== "" && pb !== "" && (pa.startsWith(pb) || pb.startsWith(pa))) return true;
  return globToRegex(a).test(samplePath(b)) || globToRegex(b).test(samplePath(a));
}

export function firstOverlap(left: string[], right: string[]): string | undefined {
  for (const a of left) for (const b of right) if (patternsOverlap(a, b)) return a === b ? a : `${a} and ${b}`;
  return undefined;
}

export function serialHits(writeSet: string[], serialOnly: string[]): string[] {
  return writeSet.filter((pattern) => serialOnly.some((rule) => globToRegex(rule).test(samplePath(pattern)) || globToRegex(pattern).test(samplePath(rule))));
}
