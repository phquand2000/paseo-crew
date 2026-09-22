import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ContentChange } from "../../shared/views.ts";
import type { Kit } from "../catalog/kit.ts";
import { digest } from "../catalog/seats.ts";
import { git } from "../core/git.ts";
import { readJson, writeJson } from "../core/store.ts";

/**
 * What of the shipped content the owner has already taken in, one entry per unit a change is told
 * about: a guide, a record template, a prompt, a skill, the team block. `commit` is the plugin's own
 * at the time, so the version they had can be read back out of git to keep.
 */
type Taken = { units: Record<string, { hash: string; commit: string | null }> };

type Kind = ContentChange["kind"];

const takenFile = (stateDir: string) => join(stateDir, "content.json");

function kindOf(unit: string): Kind | undefined {
  if (unit.startsWith("guides/")) return "guide";
  if (unit.startsWith("records/")) return "record";
  if (unit.startsWith("prompts/")) return "prompt";
  if (unit.startsWith("skills/")) return "skill";
  if (unit === "project/AGENTS.md") return "team";
  return undefined;
}

const files = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile()) : []);
const dirs = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory()) : []);

/** Every unit the kit ships now, with a hash of what it holds. A skill is one unit, its folder whole. */
export function shippedUnits(kit: Kit): Record<string, string> {
  const content = join(kit.dir, "content");
  const units: Record<string, string> = {};
  for (const group of ["guides", "records", "prompts"]) for (const name of files(join(content, group))) units[`${group}/${name}`] = digest([join(content, group, name)]);
  for (const set of dirs(join(content, "skills"))) for (const name of dirs(join(content, "skills", set))) units[`skills/${set}/${name}`] = digest([join(content, "skills", set, name)]);
  if (existsSync(join(content, "project", "AGENTS.md"))) units["project/AGENTS.md"] = digest([join(content, "project", "AGENTS.md")]);
  return units;
}

async function headOf(kit: Kit): Promise<string | null> {
  const run = await git(kit.dir, ["rev-parse", "HEAD"]);
  return run.code === 0 ? run.stdout.trim() : null;
}

/** What the kit ships differently from what the owner last took in. The first reading takes everything in as it is. */
export async function contentChanges(kit: Kit, stateDir: string): Promise<ContentChange[]> {
  const now = shippedUnits(kit);
  const held = readJson<Taken | null>(takenFile(stateDir), null);
  if (!held) {
    const commit = await headOf(kit);
    writeJson(takenFile(stateDir), { units: Object.fromEntries(Object.entries(now).map(([unit, hash]) => [unit, { hash, commit }])) });
    return [];
  }
  const changes: ContentChange[] = [];
  for (const unit of [...new Set([...Object.keys(now), ...Object.keys(held.units)])].sort()) {
    const kind = kindOf(unit);
    const before = held.units[unit];
    if (!kind || before?.hash === now[unit]) continue;
    changes.push({
      unit,
      kind,
      change: !before ? "added" : !now[unit] ? "removed" : "changed",
      kept: Boolean(kit.own && existsSync(join(kit.own, unit))),
      keepable: Boolean(before?.commit) && Boolean(now[unit]) && kind !== "guide" && kind !== "record",
    });
  }
  return changes;
}

/** The unit as it was at `commit`, written under `into`: one file, or a skill's whole folder. */
async function restore(kit: Kit, unit: string, commit: string, into: string): Promise<void> {
  const listed = await git(kit.dir, ["ls-tree", "-r", "--name-only", commit, "--", `./content/${unit}`]);
  if (listed.code !== 0) throw new Error(`git could not list ${unit} at ${commit.slice(0, 7)}: ${listed.stderr.trim()}`);
  const paths = listed.stdout.split("\n").filter(Boolean);
  if (paths.length === 0) throw new Error(`${unit} is not in ${commit.slice(0, 7)}`);
  for (const path of paths) {
    const shown = await git(kit.dir, ["show", `${commit}:./${path}`]);
    if (shown.code !== 0) throw new Error(`git could not read ${path} at ${commit.slice(0, 7)}`);
    const target = join(into, path.slice(path.indexOf(unit)));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, shown.stdout);
  }
}

/**
 * The owner's answer for one unit. `new` takes the shipped version, setting their own copy aside
 * rather than deleting it; `mine` keeps the version they had, copied out of git, for them to edit by
 * hand; `seen` takes in a guide or a record template they were only told about.
 */
export async function decide(kit: Kit, stateDir: string, unit: string, choice: "new" | "mine" | "seen", now = Date.now()): Promise<void> {
  const held = readJson<Taken>(takenFile(stateDir), { units: {} });
  const shipped = shippedUnits(kit)[unit];
  const mine = kit.own ? join(kit.own, unit) : undefined;
  if (choice === "new" && mine && existsSync(mine)) {
    const stamp = new Date(now).toISOString().replace(/\D/g, "").slice(0, 14);
    renameSync(mine, `${mine}.bak-${stamp.slice(0, 8)}-${stamp.slice(8)}`);
  }
  if (choice === "mine" && mine && !existsSync(mine)) {
    const commit = held.units[unit]?.commit;
    if (!commit) throw new Error(`there is no earlier version of ${unit} on record to keep`);
    await restore(kit, unit, commit, kit.own!);
  }
  const units = { ...held.units };
  if (shipped) units[unit] = { hash: shipped, commit: await headOf(kit) };
  else delete units[unit];
  writeJson(takenFile(stateDir), { units });
}
