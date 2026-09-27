// Fails when a tracked file in the repository names a private or tailnet address: the repository is public, so such
// values live only in a desk's own files. Documentation ranges and loopback stay allowed. Prints where, never the value.
import { spawnSync } from "node:child_process";

const RANGES: [name: string, inRange: (octets: number[]) => boolean][] = [
  ["the tailnet's CGNAT range 100.64/10", ([a, b]) => a === 100 && b! >= 64 && b! <= 127],
  ["RFC 1918 10/8", ([a]) => a === 10],
  ["RFC 1918 172.16/12", ([a, b]) => a === 172 && b! >= 16 && b! <= 31],
  ["RFC 1918 192.168/16", ([a, b]) => a === 192 && b === 168],
];
const ADDRESS = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\.?\d)/g;

const found = spawnSync(
  "git",
  ["grep", "-I", "-n", "-z", "-E", "[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}", "--", ":/"],
  { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
);
if (found.status !== 0 && found.status !== 1) throw new Error(`git grep failed: ${found.stderr}`);

const breaches: string[] = [];
for (const row of found.stdout.split("\n")) {
  const [file, line, text] = row.split("\0");
  if (text === undefined) continue;
  for (const match of text.matchAll(ADDRESS)) {
    const octets = match.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) continue;
    const range = RANGES.find(([, inRange]) => inRange(octets));
    if (range) breaches.push(`${file}:${line}: an address in ${range[0]}`);
  }
}
if (breaches.length > 0) {
  process.stderr.write(
    `${breaches.join("\n")}\nThe repository is public: use 192.0.2.x, 198.51.100.x or 203.0.113.x in its place.\n`,
  );
  process.exit(1);
}
