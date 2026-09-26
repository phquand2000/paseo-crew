import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { Attention } from "../../shared/views.ts";
import { ATTENTION } from "./attention.ts";
import type { FileKinds } from "../core/git.ts";
import { DESK_OWNED } from "../core/paths.ts";
import { ChecksFile, EcosystemFile, HarnessFile, McpFile, PaseoFile, RefusedFile, RolesFile, SensorFile } from "./schema.ts";

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

export type ArgSchema = { type?: string; enum?: unknown[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; items?: ArgSchema; minItems?: number; maxItems?: number; properties?: Record<string, ArgSchema>; required?: string[]; description?: string };

function loadToolSets(dir: string): Record<string, Record<string, ArgSchema>> {
  const file = join(dir, "mcp", "tools.json");
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, { name?: string; inputSchema?: ArgSchema }[]>;
  return Object.fromEntries(Object.entries(raw).map(([set, tools]) => [set, Object.fromEntries(tools.map((tool) => [String(tool.name ?? ""), tool.inputSchema ?? {}]))]));
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
    if (entry.rule && !existsSync(join(root, id, entry.rule))) throw new Error(`MCP ${id} names rule ${entry.rule}, which is missing`);
    for (const skill of entry.skills ?? []) {
      if (!existsSync(join(root, id, "skills", skill, "SKILL.md"))) throw new Error(`MCP ${id} names skill ${skill}, but its SKILL.md is missing`);
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

export function loadKit(dir: string, stateDir?: string): Kit {
  const raw = parsed(RolesFile, chosen(join(dir, "roles.json"), stateDir), "roles.json");
  const ecosystem = parsed(EcosystemFile, chosen(join(dir, "catalog", "ecosystem.json"), stateDir), "ecosystem.json");
  const harnesses: Record<string, HarnessSpec> = {};
  for (const id of subdirs(join(dir, "harness"))) {
    const file = join(dir, "harness", id, "harness.json");
    if (!existsSync(file)) continue;
    const harness = parsed(HarnessFile, file, `harness ${id}`);
    if (harness.id !== id) throw new Error(`harness ${id} calls itself ${harness.id} but sits in harness/${id}`);
    harnesses[id] = harness;
  }
  const roles = raw.roles.map((role) => {
    if (role.follows === undefined) return role;
    const followed = raw.roles.find((other) => other.role === role.follows);
    if (role.defaults) throw new Error(`role ${role.role} follows ${role.follows} and names defaults of its own; it takes one or the other`);
    if (!followed || followed === role) throw new Error(`role ${role.role} follows ${role.follows}, which is no other role in roles.json`);
    if (followed.follows !== undefined) throw new Error(`role ${role.role} follows ${role.follows}, which follows ${followed.follows} in turn; a role follows one that chooses for itself`);
    return { ...role, defaults: followed.defaults };
  });
  for (const role of roles) {
    if (!role.defaults) throw new Error(`role ${role.role} has no default harness`);
    const owned = (role.writes ?? []).map((entry) => entry.replace(/\/$/, "")).filter((entry) => DESK_OWNED.has(entry));
    if (owned.length > 0) throw new Error(`role ${role.role} writes ${owned.join(", ")}, which is the desk's own record`);
    if (!harnesses[role.defaults.harness]) throw new Error(`role ${role.role} defaults to harness ${role.defaults.harness}, which has no harness/${role.defaults.harness}/harness.json`);
  }
  const loaded = roles as RoleSpec[];
  const refused = parsed(RefusedFile, chosen(join(dir, "catalog", "refused.json"), stateDir), "refused.json");
  for (const name of Object.keys(refused)) {
    // A seat's own agent is started through the PATH these go first on, and its git through the shim.
    const starts = Object.values(harnesses).find((harness) => harness.provider.env?.SEATWORKS_AGENT_BIN === name);
    if (name === "git" || starts) throw new Error(`refused.json refuses ${name}, which ${starts ? `every ${starts.id} seat is started with` : "the kit's git shim runs"}, through the same PATH`);
  }
  const own = stateDir ? join(stateDir, "own") : undefined;
  return {
    dir,
    prefix: raw.providerPrefix ?? "",
    roles: loaded,
    harnesses,
    mcp: loadMcp(dir),
    toolSets: loadToolSets(dir),
    own,
    attention: { ...ATTENTION, destructive: ecosystem.watch.destructive, testPath: ecosystem.watch.testPath, suppressed: ecosystem.watch.suppressed, ...raw.attention },
    ecosystem,
    paseoTools: parsed(PaseoFile, chosen(join(dir, "catalog", "paseo.json"), stateDir), "paseo.json").tools,
    refused,
    sensors: loadSensors(dir),
    checks: parsed(ChecksFile, join(dir, "catalog", "checks.json"), "checks.json"),
  };
}

/** What a test file's change is read for: a skip marker it adds, or assertions it loses; global, since they are counted. */
type TestMarkers = { skipped: RegExp; assertion: RegExp };

export function testMarkers(kit: Kit): TestMarkers {
  return { skipped: new RegExp(kit.ecosystem.watch.skipped, "gi"), assertion: new RegExp(kit.ecosystem.watch.assertion, "gi") };
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

function shippedOrOwn(dir: string, own: string | undefined, path: string): string {
  const mine = own ? join(own, path) : undefined;
  return mine && existsSync(mine) ? mine : join(dir, "content", path);
}

export function ownOr(kit: Kit, path: string): string {
  return shippedOrOwn(kit.dir, kit.own, path);
}

/** Another role's preset for this agent, else Paseo's first: Paseo's own default cannot be read back, since the plugin sets it. */
export function agentDefault(roles: RoleSpec[], harness: HarnessSpec): ModelSpec | undefined {
  const models = harness.models ?? [];
  const preset = roles.map((role) => role.defaults).find((defaults) => defaults.harness === harness.id && defaults.model && models.some((entry) => entry.id === defaults.model));
  return models.find((entry) => entry.id === preset?.model) ?? models[0];
}

export function providerId(kit: Kit, role: string, harness: string): string {
  return `${kit.prefix}${role}-${harness}`;
}

export function seatOf(kit: Kit, provider: string | null | undefined): { role: RoleSpec; harness: HarnessSpec } | undefined {
  if (!provider) return undefined;
  const id = provider.split("/")[0] ?? "";
  if (!id.startsWith(kit.prefix)) return undefined;
  for (const role of kit.roles) {
    for (const harness of Object.values(kit.harnesses)) {
      if (id === providerId(kit, role.role, harness.id)) return { role, harness };
    }
  }
  return undefined;
}

export function hookTools(proxy: ProxySpec | undefined): string[] {
  return [proxy?.open?.tool, proxy?.close?.tool, proxy?.wait?.tool, proxy?.sync?.tool].filter((name): name is string => Boolean(name));
}

export function can(role: RoleSpec | undefined, capability: string): boolean {
  return role?.can?.includes(capability) ?? false;
}

/** `add_tasks` seats `write` roles and `start_review` `review` ones, so a role seated by either works a task without `work`. */
export function worksTasks(role: RoleSpec | undefined): boolean {
  return ["work", "write", "review"].some((capability) => can(role, capability));
}

export function roleNamed(kit: Kit, name: string | undefined): RoleSpec | undefined {
  return name ? kit.roles.find((role) => role.role === name) : undefined;
}

export function rolesThatCan(kit: Kit, capability: string): RoleSpec[] {
  return kit.roles.filter((role) => can(role, capability));
}

/** Several roles may hold one capability on purpose (two review lenses, best-of-n Peers), so the caller may name which. */
export function roleThatCan(kit: Kit, capability: string, named?: string): RoleSpec | undefined {
  const holders = rolesThatCan(kit, capability);
  return named ? holders.find((role) => role.role === named) : holders[0];
}

/** Names the roles that do hold the capability, since the kit is data and only the desk has read it. */
export function namedOrNot(kit: Kit, capability: string, named: string, doing: string): string {
  const holders = rolesThatCan(kit, capability).map((role) => role.role);
  if (holders.length === 0) return `No role in this kit can ${doing}.`;
  return `This kit has no ${named} that can ${doing}. These can: ${holders.sort().join(", ")}.`;
}

export function toolsOf(kit: Kit, role: RoleSpec | undefined): string[] {
  return role?.tools ? Object.keys(kit.toolSets[role.tools] ?? {}) : [];
}

export function schemaOf(kit: Kit, role: RoleSpec, tool: string): ArgSchema | undefined {
  return role.tools ? kit.toolSets[role.tools]?.[tool] : undefined;
}

export function roleSettingsFile(kit: Kit, harness: HarnessSpec, role: RoleSpec): string {
  return join(kit.dir, "harness", harness.id, harness.settings.roleSource.replace("ROLE", role.role));
}

export function harnessFileSources(kit: Kit, harness: HarnessSpec, role: RoleSpec): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(harness.files ?? {}).map(([path, sources]) => [path, sources.map((source) => join(kit.dir, "harness", harness.id, source.replaceAll("ROLE", role.role)))]),
  );
}

export function supportsRole(kit: Kit, harness: HarnessSpec, role: RoleSpec): boolean {
  return existsSync(roleSettingsFile(kit, harness, role)) && Object.values(harnessFileSources(kit, harness, role)).every((sources) => sources.every((source) => existsSync(source)));
}

/** `allow` disables each of Paseo's tools it omits, so a tool Paseo adds that `catalog/paseo.json` lacks stays on: keep the list in step. */
export function paseoToolsPolicy(kit: Kit, role: RoleSpec): { enabled?: boolean; disabledTools?: string[] } | undefined {
  const policy = role.paseoTools;
  if (!policy) return undefined;
  if (policy.allow) return { disabledTools: kit.paseoTools.filter((tool) => !policy.allow!.includes(tool)) };
  const { allow: _allow, ...rest } = policy;
  return rest;
}

export const TEAM_SERVER = "team";
export const PASEO_SERVER = "paseo";

export function teamServer(kit: Kit, role: RoleSpec, spool: string, node: string, choices: Record<string, Record<string, string[]>>): McpServers {
  if (!role.tools) return {};
  return { [TEAM_SERVER]: { type: "stdio", command: node, args: [join(kit.dir, "mcp", "team.mjs"), role.role, role.tools, spool, JSON.stringify(choices)] } };
}
