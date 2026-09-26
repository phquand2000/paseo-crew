import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { Attention } from "../../shared/views.ts";
import { ATTENTION } from "./attention.ts";
import type { FileKinds } from "../core/git.ts";
import { DESK_OWNED } from "../core/paths.ts";
import {
  ChecksFile,
  EcosystemFile,
  HarnessFile,
  McpFile,
  PaseoFile,
  RefusedFile,
  RolesFile,
  SensorFile,
} from "./schema.ts";

type ThinkingSpec = { id: string; label: string; isDefault?: boolean };
export type ModelSpec = { id: string; label: string; isDefault?: boolean; thinkingOptions?: ThinkingSpec[] };
export type McpServers = Record<string, unknown>;

type RoleFile = z.infer<typeof RolesFile>["roles"][number];
/** A role as loaded: one that follows another has taken that role's defaults, so every role has its own. */
export type RoleSpec = Omit<RoleFile, "defaults"> & { defaults: NonNullable<RoleFile["defaults"]> };
/** `models` is not the harness file's: Paseo lists them, and the kit holds the last list. */
export type HarnessSpec = z.infer<typeof HarnessFile> & { models?: ModelSpec[] };
export type McpEntry = z.infer<typeof McpFile> & { dir: string };
export type McpTransport = HarnessSpec["mcp"]["transports"][number];
export type Ecosystem = z.infer<typeof EcosystemFile>;
export type ProxySpec = NonNullable<McpEntry["proxy"]>;
export type SensorSpec = z.infer<typeof SensorFile>;
export type CheckSpec = z.infer<typeof ChecksFile>[string];

export type Kit = {
  dir: string;
  prefix: string;
  roles: RoleSpec[];
  harnesses: Record<string, HarnessSpec>;
  mcp: Record<string, McpEntry>;
  toolSets: Record<string, Record<string, ArgSchema>>;
  own?: string;
  attention: Attention;
  ecosystem: Ecosystem;
  paseoTools: string[];
  refused: Record<string, string>;
  sensors: Record<string, SensorSpec>;
  checks: Record<string, CheckSpec>;
};

function subdirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export type ArgSchema = {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  items?: ArgSchema;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, ArgSchema>;
  required?: string[];
  description?: string;
};

function loadToolSets(dir: string): Record<string, Record<string, ArgSchema>> {
  const file = join(dir, "mcp", "tools.json");
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, { name?: string; inputSchema?: ArgSchema }[]>;
  return Object.fromEntries(
    Object.entries(raw).map(([set, tools]) => [
      set,
      Object.fromEntries(tools.map((tool) => [String(tool.name ?? ""), tool.inputSchema ?? {}])),
    ]),
  );
}

/** Reads a JSON file against its schema, naming the file and each field that is wrong. */
function parsed<T extends z.ZodType>(schema: T, file: string, what: string): z.infer<T> {
  const result = schema.safeParse(JSON.parse(readFileSync(file, "utf-8")));
  if (!result.success) throw new Error(`${what} is not as the kit reads it:\n${z.prettifyError(result.error)}`);
  return result.data;
}

function loadMcp(dir: string): Record<string, McpEntry> {
  const root = join(dir, "catalog", "mcp");
  const entries: Record<string, McpEntry> = {};
  for (const id of subdirs(root)) {
    const file = join(root, id, "mcp.json");
    if (!existsSync(file)) continue;
    const entry = parsed(McpFile, file, `catalog/mcp/${id}/mcp.json`);
    if (entry.id !== id) throw new Error(`catalog/mcp/${id}/mcp.json names itself ${entry.id}`);
    if (entry.rule && !existsSync(join(root, id, entry.rule)))
      throw new Error(`MCP ${id} names rule ${entry.rule}, which is missing`);
    for (const skill of entry.skills ?? []) {
      if (!existsSync(join(root, id, "skills", skill, "SKILL.md")))
        throw new Error(`MCP ${id} names skill ${skill}, but its SKILL.md is missing`);
    }
    entries[id] = { ...entry, dir: join(root, id) };
  }
  return entries;
}

function loadSensors(dir: string): Record<string, SensorSpec> {
  const root = join(dir, "catalog", "sensor");
  const sensors: Record<string, SensorSpec> = {};
  for (const name of existsSync(root) ? readdirSync(root).filter((entry) => entry.endsWith(".json")) : []) {
    const sensor = parsed(SensorFile, join(root, name), `catalog/sensor/${name}`);
    if (`${sensor.id}.json` !== name) throw new Error(`catalog/sensor/${name} names itself ${sensor.id}`);
    sensors[sensor.id] = sensor;
  }
  return sensors;
}

/** The shipped file, unless the state root holds one of the same name, which replaces it: the SLP preset, or the ecosystem. */
function chosen(shipped: string, stateDir?: string): string {
  const own = stateDir ? join(stateDir, basename(shipped)) : undefined;
  return own && existsSync(own) ? own : shipped;
}

/** The kit in `dir`, with any file of the same name in `stateDir` replacing the shipped one; throws naming what is wrong. */
export function loadKit(dir: string, stateDir?: string): Kit {
  const raw = parsed(RolesFile, chosen(join(dir, "roles.json"), stateDir), "roles.json");
  const ecosystem = parsed(EcosystemFile, chosen(join(dir, "catalog", "ecosystem.json"), stateDir), "ecosystem.json");
  const harnesses = loadHarnesses(dir);
  const roles = loadRoles(raw.roles, harnesses);
  const refused = parsed(RefusedFile, chosen(join(dir, "catalog", "refused.json"), stateDir), "refused.json");
  checkRefused(refused, harnesses);
  const { watch } = ecosystem;
  return {
    dir,
    prefix: raw.providerPrefix ?? "",
    roles,
    harnesses,
    mcp: loadMcp(dir),
    toolSets: loadToolSets(dir),
    own: stateDir ? join(stateDir, "own") : undefined,
    attention: {
      ...ATTENTION,
      destructive: watch.destructive,
      testPath: watch.testPath,
      suppressed: watch.suppressed,
      ...raw.attention,
    },
    ecosystem,
    paseoTools: parsed(PaseoFile, chosen(join(dir, "catalog", "paseo.json"), stateDir), "paseo.json").tools,
    refused,
    sensors: loadSensors(dir),
    checks: parsed(ChecksFile, join(dir, "catalog", "checks.json"), "checks.json"),
  };
}

function loadHarnesses(dir: string): Record<string, HarnessSpec> {
  const harnesses: Record<string, HarnessSpec> = {};
  for (const id of subdirs(join(dir, "harness"))) {
    const file = join(dir, "harness", id, "harness.json");
    if (!existsSync(file)) continue;
    const harness = parsed(HarnessFile, file, `harness ${id}`);
    if (harness.id !== id) throw new Error(`harness ${id} calls itself ${harness.id} but sits in harness/${id}`);
    harnesses[id] = harness;
  }
  return harnesses;
}

/** Each role with its defaults, a follower taking those of the role it follows; checked against the harnesses there are. */
function loadRoles(listed: RoleFile[], harnesses: Record<string, HarnessSpec>): RoleSpec[] {
  const roles = listed.map((role) => {
    if (role.follows === undefined) return role;
    const followed = listed.find((other) => other.role === role.follows);
    if (role.defaults)
      throw new Error(
        `role ${role.role} follows ${role.follows} and names defaults of its own; it takes one or the other`,
      );
    if (!followed || followed === role)
      throw new Error(`role ${role.role} follows ${role.follows}, which is no other role in roles.json`);
    if (followed.follows !== undefined)
      throw new Error(
        `role ${role.role} follows ${role.follows}, which follows ${followed.follows} in turn; a role follows one that chooses for itself`,
      );
    return { ...role, defaults: followed.defaults };
  });
  for (const role of roles) {
    if (!role.defaults) throw new Error(`role ${role.role} has no default harness`);
    const owned = (role.writes ?? []).map((entry) => entry.replace(/\/$/, "")).filter((entry) => DESK_OWNED.has(entry));
    if (owned.length > 0)
      throw new Error(`role ${role.role} writes ${owned.join(", ")}, which is the desk's own record`);
    if (!harnesses[role.defaults.harness])
      throw new Error(
        `role ${role.role} defaults to harness ${role.defaults.harness}, which has no harness/${role.defaults.harness}/harness.json`,
      );
  }
  return roles as RoleSpec[];
}

/** A seat's own agent is started through the PATH these go first on, and its git through the shim: neither may be refused. */
function checkRefused(refused: Record<string, string>, harnesses: Record<string, HarnessSpec>): void {
  for (const name of Object.keys(refused)) {
    const starts = Object.values(harnesses).find((harness) => harness.provider.env?.SEATWORKS_AGENT_BIN === name);
    if (name === "git" || starts)
      throw new Error(
        `refused.json refuses ${name}, which ${starts ? `every ${starts.id} seat is started with` : "the kit's git shim runs"}, through the same PATH`,
      );
  }
}

/** What a test file's change is read for: a skip marker it adds, or assertions it loses; global, since they are counted. */
type TestMarkers = { skipped: RegExp; assertion: RegExp };

export function testMarkers(kit: Kit): TestMarkers {
  return {
    skipped: new RegExp(kit.ecosystem.watch.skipped, "gi"),
    assertion: new RegExp(kit.ecosystem.watch.assertion, "gi"),
  };
}

/** How a change to a test file weakened it, if it did: a new skip marker, or fewer assertions. */
export function weakened(before: string, after: string, markers: TestMarkers): string | undefined {
  const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;
  if (count(after, markers.skipped) > count(before, markers.skipped)) return "adds a skip marker";
  const [was, now] = [count(before, markers.assertion), count(after, markers.assertion)];
  return now < was ? `${was} assertions become ${now}` : undefined;
}

/** The patterns the watch reads calls with: the ecosystem's, and attention's where a settings layer set its own. */
export function watchPatterns(kit: Kit, attention: Attention) {
  return {
    destructive: new RegExp(attention.destructive, "i"),
    testPath: new RegExp(attention.testPath, "i"),
    suppressed: new RegExp(attention.suppressed, "i"),
    ...testMarkers(kit),
    runners: new Set(kit.ecosystem.watch.runners),
  };
}

export function fileKinds(kit: Kit): FileKinds {
  return { test: new RegExp(kit.ecosystem.files.test, "i"), docs: new RegExp(kit.ecosystem.files.docs, "i") };
}

export const TEAM_SERVER = "team";
/** What a seat's team server tells the desk it is: the key the seat was created with. */
export const SEAT_KEY = "SEATWORKS_DESK_KEY";
export const PASEO_SERVER = "paseo";
