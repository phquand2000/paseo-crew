import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { LAND_AS, type LandAs, gitCommonDir, trackedFiles } from "../../core/git.ts";
import { getPath } from "../../core/json.ts";
import { stateRoot } from "../../core/paths.ts";
import { readJson, writeJson } from "../../core/store.ts";
import type { Ecosystem, Kit } from "../../catalog/kit/kit.ts";
import { RiskRule } from "../../catalog/kit/schema/ecosystem.ts";
import { coverOf, serialPaths } from "../../core/scope.ts";

export type Project = { root: string; slug: string; state: string };

type GateOn = "lane" | "task";

export const LANE_HOMES = ["onBranch", "newBranch", "isolate"] as const;
/** Where a lane works when the call opening it does not say: the Human's standing answer to the question status asks. */
export type LaneHome = (typeof LANE_HOMES)[number];

/**
 * `serialOnly` and `riskRules` are the project's own when it set them; without, the kit's hold, so a change to the kit reaches it.
 * `askFirst` is the Human's standing order: a landing that touches one of these paths waits for them.
 * `links`, `writable`, `writableOutside` and `sockets` are the Human's alone, set by hand: they widen what seats may write or reach.
 */
export type ProjectConfig = {
  base?: string;
  gate?: string;
  gateTimeoutMinutes: number;
  gateOn: GateOn;
  serialOnly?: string[];
  landAs: LandAs;
  laneHome?: LaneHome;
  askFirst: string[];
  riskRules?: RiskRule[];
  links: string[];
  writable: string[];
  writableOutside: string[];
  sockets: string[];
};

/** Enough for every copy a machine keeps at once: copy paths are never reused, so an unbounded cache grew for good. */
const CACHED_PROJECTS = 512;
const cache = new Map<string, Project>();

export function gitRoot(cwd: string): string {
  const common = gitCommonDir(cwd);
  if (!common) return cwd;
  return basename(common) === ".git" ? dirname(common) : common;
}

function slugFor(root: string): string {
  const name =
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project";
  return `${name}-${createHash("sha1").update(root).digest("hex").slice(0, 6)}`;
}

export function projectOf(cwd: string, base = stateRoot(), rootOf: (cwd: string) => string = gitRoot): Project {
  const key = `${base}\n${cwd}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const root = rootOf(cwd);
  const slug = slugFor(root);
  const project = { root, slug, state: join(base, "projects", slug) };
  cache.set(key, project);
  if (cache.size > CACHED_PROJECTS) cache.delete(cache.keys().next().value!);
  return project;
}

/** What a script a package file names runs, or undefined where the file or the script cannot be read. */
function scriptBody(file: string, name: string): string | undefined {
  try {
    const body = getPath(JSON.parse(readFileSync(file, "utf-8")) as unknown, ["scripts", name]);
    return typeof body === "string" ? body : undefined;
  } catch {
    return undefined;
  }
}

/** A script a package file names, unless it is the placeholder its tool writes when there is none. */
function scriptIn(file: string, name: string, unset: string): boolean {
  const body = scriptBody(file, name);
  return body !== undefined && !body.includes(unset);
}

/** The first of the ecosystem's gates whose files the project holds; one that runs a package script needs that script. */
export function detectGate(root: string, ecosystem: Ecosystem): string | undefined {
  const has = (name: string) => existsSync(join(root, name));
  for (const gate of ecosystem.gates) {
    const file = gate.files.find(has);
    if (!file || (gate.script && !scriptIn(join(root, file), gate.script, ecosystem.unsetScript))) continue;
    return Object.entries(gate.lockfiles ?? {}).find(([lockfile]) => has(lockfile))?.[1] ?? gate.run;
  }
  return undefined;
}

/** The commands that run `gate`: the gate first, then the test runner its script starts, which is how a seat runs its own module's tests. */
export function gateCommands(root: string, gate: string | undefined, ecosystem: Ecosystem): string[] {
  if (!gate?.trim()) return [];
  const script = new RegExp(`^(?:${ecosystem.scriptRunners.join("|")})(?: run)? ([\\w:.-]+)$`).exec(gate.trim())?.[1];
  const body = script ? scriptBody(join(root, "package.json"), script) : undefined;
  if (body === undefined) return [gate];
  // The script's last command runs the tests; its runner is the program plus at most one word, never a path.
  const words = body
    .split(/&&|\|\||;/)
    .at(-1)!
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  const runner = words.slice(0, words.findIndex((word) => !/^[\w@.:-]+$/.test(word)) >>> 0).join(" ");
  return runner && runner !== gate ? [gate, runner] : [gate];
}

export function configFile(state: string): string {
  return join(state, "project.json");
}

/** The Supervisor alone writes it; a Lead is pointed at it once there is one. */
export function conceptFile(state: string): string | undefined {
  const file = join(state, "CONTEXT.md");
  return existsSync(file) ? file : undefined;
}

/** An empty gate is the owner's decision and must survive a read: as `undefined`, `open_lane` would seed a detected gate over it. */
export function loadConfig(state: string): ProjectConfig {
  const stored = readJson<Partial<ProjectConfig>>(configFile(state), {});
  const minutes = Number(stored.gateTimeoutMinutes);
  return {
    base: typeof stored.base === "string" && stored.base ? stored.base : undefined,
    gate: typeof stored.gate === "string" ? stored.gate : undefined,
    gateTimeoutMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 30,
    gateOn: stored.gateOn === "lane" ? "lane" : "task",
    serialOnly: Array.isArray(stored.serialOnly) ? stored.serialOnly.map(String) : undefined,
    landAs: LAND_AS.find((as) => as === stored.landAs) ?? "squash",
    laneHome: LANE_HOMES.find((home) => home === stored.laneHome),
    askFirst: Array.isArray(stored.askFirst) ? stored.askFirst.map(String) : [],
    // A list that does not read as rules falls to the kit's, which ask more rather than less.
    riskRules: RiskRule.array().safeParse(stored.riskRules).data,
    links: Array.isArray(stored.links) ? stored.links.map(String) : [],
    writable: Array.isArray(stored.writable) ? stored.writable.map(String) : [],
    writableOutside: Array.isArray(stored.writableOutside) ? stored.writableOutside.map(String) : [],
    sockets: Array.isArray(stored.sockets) ? stored.sockets.map(String) : [],
  };
}

/**
 * Where the next lane works in a project whose own copy is free: as its call or the Human's standing choice says, or else the
 * question the Human answers first, which is real only over uncommitted work or a branch that is not the base.
 */
export function laneHomeFor(
  asked: LaneHome | undefined,
  config: ProjectConfig,
  branch: string | undefined,
  work: string[] | undefined,
): LaneHome | { question: string } {
  const chosen = asked ?? config.laneHome;
  if (chosen === "onBranch" || chosen === "isolate") return chosen;
  // A new branch here would be switched to over the Human's uncommitted work, so that choice cannot hold while there is some.
  if (!branch || !work || (chosen === "newBranch" && work.length === 0)) return "newBranch";
  if (work.length > 0)
    return {
      question: `carry on ${branch} here (onBranch), a new branch that takes the uncommitted work along (onBranch with newBranch), or a copy of its own that leaves it where it is (isolate)`,
    };
  if (!config.base || branch === config.base) return "newBranch";
  return {
    question: `carry on ${branch} here (onBranch), a new branch off ${config.base} here (isolate false), or a copy of its own (isolate)`,
  };
}

/** The paths only one writer at a time may write in this project. */
export function serialOnlyOf(project: Project, kit: Kit): string[] {
  return loadConfig(project.state).serialOnly ?? kit.ecosystem.serialOnly;
}

/** The paths of `cwd` that one writer at a time may write, as git tracks them now: read before a placement is decided. */
export async function serialIn(kit: Kit, project: Project, cwd: string): Promise<string[]> {
  return serialPaths(await trackedFiles(cwd), serialOnlyOf(project, kit));
}

export function riskRulesOf(project: Project, kit: Kit): RiskRule[] {
  return loadConfig(project.state).riskRules ?? kit.ecosystem.riskRules;
}

/** The rules whose paths cover any of `files`: what a review of them must answer, and what rehearses them. */
export function rulesFor(rules: RiskRule[], files: string[]): RiskRule[] {
  return rules.filter((rule) => rule.paths.map(coverOf).some((cover) => files.some((file) => cover.test(file))));
}

export function saveConfig(state: string, config: ProjectConfig): void {
  writeJson(configFile(state), config);
}
