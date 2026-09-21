import { existsSync, readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { DESTRUCTIVE, FACT_LEVELS, SUPPRESSED, TEST_PATH } from "../runtime/watch/facts.ts";
import { LEAST_STATE_CHARS, VIEW_FIELDS, type ViewName, isView } from "../runtime/watch/jev/views.ts";
import { AttentionChoice } from "./settings.ts";
import { type TemplateSpec, loadTemplates } from "./templates.ts";
import { isAbsolute, join } from "node:path";
import { errorText } from "../core/errors.ts";

export type ThinkingSpec = { id: string; label: string; isDefault?: boolean };
export type ModelSpec = { id: string; label: string; isDefault?: boolean; thinkingOptions?: ThinkingSpec[] };
export type McpServers = Record<string, unknown>;
export type McpTransport = "stdio" | "http" | "sse";

export type RoleSpec = {
  role: string;
  label: string;
  description?: string;
  /** What this seat specialises in, so several seats can supervise one project without being the same seat. */
  concern?: string;
  /** What this seat is allowed to be asked to do. An open set: the desk asks whether a seat can do a thing, never what it is called. */
  can?: string[];
  /** Which set of tools in mcp/tools.json this seat is given. Several roles may share one set. */
  tools?: string;
  defaults: { harness: string; model?: string; thinking?: string };
  prompt: string;
  skills: string | null;
  extraSkills?: string[];
  paseoTools?: { enabled?: boolean; disabledTools?: string[]; allow?: string[] };
  hidesWords?: string[];
};

export type HarnessSpec = {
  id: string;
  label: string;
  baseProvider: string;
  configDirEnv: string;
  profileRoot: string;
  promptFile?: string;
  contextFile?: string;
  skillsDir: string;
  hasThinking?: boolean;
  steers?: boolean;
  systemPrompt?: "config" | "file";
  stateWrites?: { path: string; delivery: "launch" | "file" };
  projectContextOption?: string;
  exitPattern?: string;
  settings: { file: string; source: string; roleSource: string; ownedPaths?: string[] };
  links?: { link: string; target: string; optional?: boolean }[];
  files?: Record<string, string[]>;
  modelCatalog?: { command: string[]; list: string; clear: string[]; file: string; setting: string };
  checks?: { path: string; help: string }[];
  models?: ModelSpec[];
  modes?: { id: string; label: string }[];
  mcp: {
    file: string;
    delivery: "launch" | "file";
    transports: McpTransport[];
    seed?: Record<string, unknown>;
    key?: string;
    clear?: { set?: Record<string, unknown>; remove?: string[]; setInEach?: Record<string, Record<string, unknown>> };
    rule?: string;
    /** Fields this agent reads on the desk's own server entry beyond its command, merged into it. */
    desk?: Record<string, unknown>;
  };
  provider: { env?: Record<string, string>; profileModeId?: string; command?: string[]; forceFlags?: Record<string, string> };
};

const HARNESS_FIELDS = new Set([
  "id",
  "label",
  "baseProvider",
  "configDirEnv",
  "profileRoot",
  "promptFile",
  "contextFile",
  "skillsDir",
  "hasThinking",
  "steers",
  "systemPrompt",
  "stateWrites",
  "projectContextOption",
  "exitPattern",
  "settings",
  "links",
  "files",
  "modelCatalog",
  "checks",
  "models",
  "modes",
  "mcp",
  "provider",
]);
const HARNESS_REQUIRED = ["id", "label", "baseProvider", "configDirEnv", "profileRoot", "skillsDir", "settings", "mcp", "provider"];

export function harnessProblems(id: string, raw: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(raw)) if (!HARNESS_FIELDS.has(key)) problems.push(`names ${key}, which is no harness field`);
  for (const key of HARNESS_REQUIRED) if (raw[key] === undefined) problems.push(`has no ${key}`);
  if (raw.id !== undefined && raw.id !== id) problems.push(`calls itself ${String(raw.id)} but sits in harness/${id}`);
  const settings = raw.settings as Record<string, unknown> | undefined;
  if (settings) for (const key of ["file", "source", "roleSource"]) if (settings[key] === undefined) problems.push(`has no settings.${key}`);
  const mcp = raw.mcp as Record<string, unknown> | undefined;
  if (mcp) {
    for (const key of ["file", "delivery", "transports"]) if (mcp[key] === undefined) problems.push(`has no mcp.${key}`);
    if (mcp.delivery !== undefined && mcp.delivery !== "launch" && mcp.delivery !== "file") problems.push(`delivers MCP servers as ${String(mcp.delivery)}, which is neither launch nor file`);
    if (mcp.delivery === "file" && !mcp.key) problems.push("delivers MCP servers in a file but names no mcp.key");
    if (Array.isArray(mcp.transports) && mcp.transports.length === 0) problems.push("lists no mcp.transports");
    if (mcp.desk !== undefined && (typeof mcp.desk !== "object" || mcp.desk === null || Array.isArray(mcp.desk))) problems.push("gives mcp.desk fields that are not an object");
  }
  if (raw.steers !== undefined && typeof raw.steers !== "boolean") problems.push(`says steers is ${String(raw.steers)}, which is neither true nor false`);
  const writes = raw.stateWrites as Record<string, unknown> | undefined;
  if (writes !== undefined && (typeof writes?.path !== "string" || (writes.delivery !== "launch" && writes.delivery !== "file"))) {
    problems.push("gives stateWrites without a path and a delivery of launch or file");
  }
  if (raw.projectContextOption !== undefined && (typeof raw.projectContextOption !== "string" || raw.projectContextOption === "")) {
    problems.push("gives projectContextOption without an option path");
  }
  const files = raw.files as Record<string, unknown> | undefined;
  if (files !== undefined) {
    for (const [path, sources] of Object.entries(files ?? {})) {
      if (!Array.isArray(sources) || sources.length === 0 || sources.some((source) => typeof source !== "string")) problems.push(`lays down ${path} from no list of sources`);
    }
  }
  const catalog = raw.modelCatalog as Record<string, unknown> | undefined;
  if (catalog !== undefined) {
    const command = catalog?.command;
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string")) problems.push("takes its model catalog from no command");
    for (const key of ["list", "file", "setting"]) if (typeof catalog?.[key] !== "string") problems.push(`has no modelCatalog.${key}`);
    if (!Array.isArray(catalog?.clear)) problems.push("has no modelCatalog.clear");
  }
  const checks = raw.checks as unknown;
  if (checks !== undefined && (!Array.isArray(checks) || checks.some((check) => typeof check?.path !== "string" || typeof check?.help !== "string"))) {
    problems.push("lists checks without a path and a help each");
  }
  const modes = raw.modes as { id?: unknown; label?: unknown }[] | undefined;
  if (modes !== undefined && (!Array.isArray(modes) || modes.some((mode) => typeof mode?.id !== "string" || typeof mode?.label !== "string"))) {
    problems.push("lists modes without an id and a label each");
  }
  else if (raw.baseProvider === "acp" && !modes?.length) problems.push("extends acp but lists no modes for Paseo to read without launching it");
  else if (modes) {
    const modeId = (raw.provider as Record<string, unknown> | undefined)?.profileModeId;
    if (typeof modeId === "string" && !modes.some((mode) => mode.id === modeId)) problems.push(`opens seats in mode ${modeId}, which its modes do not list`);
  }
  if (raw.exitPattern !== undefined) {
    let groups = -1;
    try {
      groups = new RegExp(`${String(raw.exitPattern)}|`).exec("")!.length - 1;
    } catch {}
    if (typeof raw.exitPattern !== "string" || groups < 1) problems.push("gives an exitPattern that is not a pattern capturing the exit code");
  }
  if (raw.systemPrompt !== undefined && raw.systemPrompt !== "config" && raw.systemPrompt !== "file") problems.push(`takes its prompt as ${String(raw.systemPrompt)}, which is neither config nor file`);
  if (raw.systemPrompt === "file" && !raw.promptFile) problems.push("takes its prompt as a file but names no promptFile");
  return problems;
}

export type ProxyBackend = { type: "http"; url: string } | { type: "stdio"; command: string[] };
export type ProxyHook = { tool: string; args?: Record<string, unknown>; when?: string; timeoutSeconds?: number };

export type ProxySpec = {
  backend: ProxyBackend;
  pin?: string;
  gitExclude?: string[];
  open?: ProxyHook & { route?: { when: string; from: string; field: string } };
  /** Undoes `open` for a copy the desk is removing; never called for the project's own. */
  close?: ProxyHook;
  wait?: ProxyHook & { busy?: string; seconds?: number; pollSeconds?: number };
  sync?: { tool: string; paths?: string; maxPaths?: number };
  errors?: { when: string; reply: string }[];
  descriptions?: Record<string, string>;
  timeoutSeconds?: number;
};

export type McpSetting = { type: "number" | "string" | "boolean"; label: string; default?: string | number | boolean };

export type McpEntry = {
  id: string;
  label: string;
  description?: string;
  order?: number;
  dir: string;
  kind: "proxy" | "server";
  proxy?: ProxySpec;
  instructions?: string;
  server?: Record<string, unknown> & { type: McpTransport };
  settings: Record<string, McpSetting>;
  defaults: { enabled: boolean };
  tools?: Record<string, string[]>;
  roles?: string[];
  rule?: string;
  roleNotes?: Record<string, string>;
  skills?: string[];
  help?: string;
  /** Paths the project must have for this server to serve it, relative to its root. */
  requires?: string[];
};

export type Attention = {
  tickSeconds: number;
  leadIdleMinutes: number;
  askRemindMinutes: number;
  maxReminders: number;
  /** Whether an incident may reach the seat above at all. Off still records every incident; it stops the desk sending them. */
  watch: boolean;
  destructive: string;
  testPath: string;
  repeatsAt: number;
  reworksAt: number;
  reviewsAt: number;
  suppressed: string;
  longTurnMinutes: number;
  incidentsPerDay: number;
};

export type Question = {
  /** The state it is asked over: each question is shown only what it reads. */
  view: ViewName;
  instructions: string;
  criteria?: { true: string; false: string };
  threshold?: number;
  level?: "page" | "attend";
  alone?: boolean;
  agrees?: string[];
  confirms?: string[];
  needs?: string[];
  /** A finding on a step that speaks of a file a sibling task is writing is expected, and not raised. */
  excusedBeside?: boolean;
  /** What a person reads for it on a screen. Never sent to the sensor. */
  label?: string;
};

export type SensorSpec = {
  id: string;
  url: string;
  model: string;
  timeoutSeconds: number;
  retries: number;
  stateChars: number;
  debounceSeconds: number;
  everySeconds: number;
  unclear: number;
  questions: Record<string, Question>;
};

export type Kit = {
  dir: string;
  prefix: string;
  roles: RoleSpec[];
  harnesses: Record<string, HarnessSpec>;
  mcp: Record<string, McpEntry>;
  /** Each tool set in mcp/tools.json: its tools by name, with the schema each is shown with. */
  toolSets: Record<string, Record<string, ArgSchema>>;
  templates: Record<string, TemplateSpec>;
  sensors: Record<string, SensorSpec>;
  attention: Attention;
};

const ATTENTION: Attention = {
  tickSeconds: 30, leadIdleMinutes: 12, askRemindMinutes: 15, maxReminders: 2,
  watch: false,
  destructive: DESTRUCTIVE,
  testPath: TEST_PATH,
  repeatsAt: 3,
  reworksAt: 3,
  reviewsAt: 3,
  suppressed: SUPPRESSED,
  longTurnMinutes: 30,
  incidentsPerDay: 5,
};

function subdirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** The part of JSON Schema the desk's tools are written in, and every call to them is checked against. */
export type ArgSchema = { type?: string; enum?: unknown[]; items?: ArgSchema; properties?: Record<string, ArgSchema>; required?: string[]; description?: string };

function loadToolSets(dir: string): Record<string, Record<string, ArgSchema>> {
  const file = join(dir, "mcp", "tools.json");
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, { name?: string; inputSchema?: ArgSchema }[]>;
  return Object.fromEntries(Object.entries(raw).map(([set, tools]) => [set, Object.fromEntries(tools.map((tool) => [String(tool.name ?? ""), tool.inputSchema ?? {}]))]));
}

/** Where a proxy entry keeps something this kit will hand to `new RegExp`. */
function patternsOf(proxy: ProxySpec | undefined): [string, string][] {
  if (!proxy) return [];
  const found: [string, string][] = [];
  if (proxy.open?.when) found.push(["open.when", proxy.open.when]);
  if (proxy.open?.route?.when) found.push(["open.route.when", proxy.open.route.when]);
  if (proxy.wait?.when) found.push(["wait.when", proxy.wait.when]);
  if (proxy.wait?.busy) found.push(["wait.busy", proxy.wait.busy]);
  for (const [index, entry] of (proxy.errors ?? []).entries()) if (entry?.when) found.push([`errors[${index}].when`, entry.when]);
  return found;
}

function loadMcp(dir: string): Record<string, McpEntry> {
  const root = join(dir, "catalog", "mcp");
  const entries: Record<string, McpEntry> = {};
  for (const id of subdirs(root)) {
    const file = join(root, id, "mcp.json");
    if (!existsSync(file)) continue;
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Omit<McpEntry, "dir">;
    if (raw.id !== id) throw new Error(`catalog/mcp/${id}/mcp.json names itself ${raw.id}`);
    const backend = raw.kind === "proxy" ? raw.proxy?.backend : undefined;
    if (raw.kind === "proxy" && !(backend?.type === "http" && backend.url) && !(backend?.type === "stdio" && backend.command?.length)) {
      throw new Error(`MCP ${id} is a proxy with no http url or stdio command for its backend`);
    }
    if (raw.kind === "server" && !raw.server?.type) throw new Error(`MCP ${id} is a server with no transport type`);
    // Every pattern a proxy entry carries is compiled per call, inside a try that answers the seat
    // "the server is not reachable". A typo in one therefore looked like a server that was down, on
    // every call, with nothing naming the entry — and a preset is written by whoever writes the kit.
    for (const [where, pattern] of patternsOf(raw.proxy)) {
      try {
        new RegExp(pattern, "i");
      } catch (error) {
        throw new Error(`MCP ${id} has an unreadable pattern in ${where}: ${errorText(error)}`);
      }
    }
    if (raw.rule && !existsSync(join(root, id, raw.rule))) throw new Error(`MCP ${id} names rule ${raw.rule}, which is missing`);
    if (raw.requires !== undefined && !(Array.isArray(raw.requires) && raw.requires.every((path) => typeof path === "string" && path !== "" && !isAbsolute(path)))) {
      throw new Error(`MCP ${id} requires something that is not a list of paths inside the project`);
    }
    for (const skill of raw.skills ?? []) {
      if (!existsSync(join(root, id, "skills", skill, "SKILL.md"))) throw new Error(`MCP ${id} names skill ${skill}, but its SKILL.md is missing`);
    }
    entries[id] = { ...raw, settings: raw.settings ?? {}, defaults: { enabled: raw.defaults?.enabled ?? false }, dir: join(root, id) };
  }
  return entries;
}

const SENSOR_KEYS = ["id", "url", "model", "timeoutSeconds", "retries", "stateChars", "debounceSeconds", "everySeconds", "unclear", "questions"];
const QUESTION_KEYS = ["view", "instructions", "criteria", "threshold", "level", "alone", "agrees", "confirms", "needs", "excusedBeside", "label"];

export function sensorProblems(id: string, raw: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (raw.id !== id) problems.push(`calls itself ${String(raw.id)} but sits in catalog/sensor/${id}`);
  for (const key of ["url", "model"]) if (typeof raw[key] !== "string" || !raw[key]) problems.push(`has no ${key}`);
  if (typeof raw.url === "string" && !raw.url.startsWith("https://")) problems.push("sends its state somewhere that is not https");
  for (const key of ["timeoutSeconds", "stateChars", "debounceSeconds", "everySeconds"]) if (typeof raw[key] !== "number" || !((raw[key] as number) > 0)) problems.push(`has no positive ${key}`);
  if (typeof raw.stateChars === "number" && raw.stateChars > 0 && raw.stateChars < LEAST_STATE_CHARS) problems.push(`sends a state of fewer than ${LEAST_STATE_CHARS} characters, too few to say anything`);
  if (!Number.isInteger(raw.retries) || (raw.retries as number) < 0) problems.push("has no whole number of retries");
  const questions = raw.questions as Record<string, Record<string, unknown>> | undefined;
  if (!questions || typeof questions !== "object" || Object.keys(questions).length === 0) problems.push("asks no questions");
  if (typeof raw.unclear !== "number" || !(raw.unclear > 0 && raw.unclear < 0.5)) problems.push("has no unclear band between 0 and 0.5");
  for (const key of Object.keys(raw)) if (!SENSOR_KEYS.includes(key)) problems.push(`has ${key}, which a sensor does not take`);
  const kinds = (value: unknown, levels: string[]) => Array.isArray(value) && value.length > 0 && value.every((kind) => typeof kind === "string" && levels.includes(FACT_LEVELS[kind] ?? ""));
  for (const [name, question] of Object.entries(questions ?? {})) {
    if (typeof question?.instructions !== "string" || !question.instructions) problems.push(`asks ${name} without instructions`);
    if (!isView(question?.view)) problems.push(`asks ${name} over ${String(question?.view)}, which is not a view (${Object.keys(VIEW_FIELDS).join(", ")})`);
    for (const key of Object.keys(question ?? {})) if (!QUESTION_KEYS.includes(key)) problems.push(`asks ${name} with ${key}, which a question does not take`);
    const criteria = question?.criteria as Record<string, unknown> | null | undefined;
    if (criteria !== undefined && (!criteria || typeof criteria !== "object" || Array.isArray(criteria) || Object.keys(criteria).sort().join() !== "false,true" || !criteria.true || !criteria.false || typeof criteria.true !== "string" || typeof criteria.false !== "string")) {
      problems.push(`asks ${name} with criteria that are not a true and a false text`);
    }
    const opens = question?.alone === true || question?.agrees !== undefined;
    const decides = opens || question?.confirms !== undefined;
    if (decides && (typeof question?.threshold !== "number" || question.threshold < 0 || question.threshold > 1)) problems.push(`asks ${name} with no threshold between 0 and 1`);
    if (opens && question?.level !== "page" && question?.level !== "attend") problems.push(`asks ${name} at a level that is neither page nor attend`);
    if (!opens && question?.level !== undefined) problems.push(`asks ${name} with a level, though it opens no incident of its own`);
    if (!decides && question?.threshold !== undefined) problems.push(`asks ${name} with a threshold, though nothing decides on its answer`);
    if (question?.agrees !== undefined && !kinds(question.agrees, ["page", "attend", "note"])) problems.push(`asks ${name} with agrees that is not a list of fact kinds`);
    if (question?.confirms !== undefined && !kinds(question.confirms, ["attend"])) problems.push(`asks ${name} with confirms that is not a list of attention-level fact kinds`);
    if (question?.alone && (question?.agrees || question?.confirms)) problems.push(`asks ${name} both alone and tied to facts`);
    const fields: readonly string[] = isView(question?.view) ? VIEW_FIELDS[question.view] : [];
    if (question?.needs !== undefined && (!Array.isArray(question.needs) || question.needs.length === 0 || question.needs.some((field) => !fields.includes(field)))) {
      problems.push(`asks ${name} with needs that is not a list of its view's fields (${fields.join(", ")})`);
    }
    if (question?.label !== undefined && (typeof question.label !== "string" || !question.label.trim())) problems.push(`asks ${name} with a label that is not text`);
    if (question?.excusedBeside !== undefined && (question.excusedBeside !== true || !opens)) problems.push(`asks ${name} excused beside, though it opens no incident to excuse`);
  }
  return problems;
}

function loadSensors(dir: string): Record<string, SensorSpec> {
  const root = join(dir, "catalog", "sensor");
  const sensors: Record<string, SensorSpec> = {};
  for (const id of subdirs(root)) {
    const file = join(root, id, "sensor.json");
    if (!existsSync(file)) continue;
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    const problems = sensorProblems(id, raw);
    if (problems.length > 0) throw new Error(`sensor ${id} ${problems.join("; ")}`);
    sensors[id] = raw as unknown as SensorSpec;
  }
  return sensors;
}

/**
 * Which roles this kit runs. The kit ships SLP as its preset; a file of the same name in the state
 * root replaces it, so somebody who wants a different arrangement writes one rather than forking
 * this. A role in that file may name its prompt and skills by absolute path, which is what makes an
 * arrangement outside this package possible at all.
 */
export function rolesFile(dir: string, stateDir?: string): string {
  const own = stateDir ? join(stateDir, "roles.json") : undefined;
  return own && existsSync(own) ? own : join(dir, "roles.json");
}

export function loadKit(dir: string, stateDir?: string): Kit {
  const raw = JSON.parse(readFileSync(rolesFile(dir, stateDir), "utf-8"));
  const harnesses: Record<string, HarnessSpec> = {};
  for (const id of subdirs(join(dir, "harness"))) {
    const file = join(dir, "harness", id, "harness.json");
    if (!existsSync(file)) continue;
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    const problems = harnessProblems(id, raw);
    if (problems.length > 0) throw new Error(`harness ${id} ${problems.join("; ")}`);
    harnesses[id] = raw as unknown as HarnessSpec;
  }
  const roles = (raw.roles ?? []) as RoleSpec[];
  for (const role of roles) {
    if (!role.defaults?.harness) throw new Error(`role ${role.role} has no default harness`);
    if (!harnesses[role.defaults.harness]) throw new Error(`role ${role.role} defaults to harness ${role.defaults.harness}, which has no harness/${role.defaults.harness}/harness.json`);
  }
  return {
    dir,
    prefix: typeof raw.providerPrefix === "string" ? raw.providerPrefix : "",
    roles,
    harnesses,
    mcp: loadMcp(dir),
    toolSets: loadToolSets(dir),
    templates: loadTemplates(dir),
    sensors: loadSensors(dir),
    attention: { ...ATTENTION, ...presetAttention(raw.attention) },
  };
}

/**
 * The preset's attention, held to the same rules as a settings layer's. Merged unchecked, a pattern
 * the settings screen would have refused — a typo in `destructive` — threw on every turn ending
 * instead, inside the step that also sends that seat its waiting mail.
 */
function presetAttention(raw: unknown): Partial<Attention> {
  if (raw === undefined) return {};
  const parsed = AttentionChoice.safeParse(raw);
  if (!parsed.success) throw new Error(`roles.json has an attention block the desk cannot use: ${z.prettifyError(parsed.error)}`);
  return parsed.data as Partial<Attention>;
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

/**
 * Whether the desk serves a role as one working a task: its `ask` goes to its Lead, its quiet turns are
 * nudged, its hand-back is read. `start_task` seats a role that can `write` and `start_review` one that
 * can `review`; asked only about `work`, a kit role seated by either and lacking `work` was answered
 * "Unknown tool ask." and its silent turns were never noticed — a rule that lived in one code comment.
 */
export function worksTasks(role: RoleSpec | undefined): boolean {
  return ["work", "write", "review"].some((capability) => can(role, capability));
}

/** The role a stored name refers to, so a name kept on disk can still be asked what it can do. */
export function roleNamed(kit: Kit, name: string | undefined): RoleSpec | undefined {
  return name ? kit.roles.find((role) => role.role === name) : undefined;
}

export function rolesThatCan(kit: Kit, capability: string): RoleSpec[] {
  return kit.roles.filter((role) => can(role, capability));
}

/**
 * The role to seat for a capability: the one named, or the kit's first as the preset's default.
 *
 * Several roles may hold one capability on purpose. Two lenses on one review are only evidence if
 * they are not the same reader, and a second work role is how best-of-n gets two kinds of Peer.
 * Taking the first match and offering the caller no say made every extra role the owner declared
 * unreachable — the role set was open data that only one member of could ever be seated.
 */
export function roleThatCan(kit: Kit, capability: string, named?: string): RoleSpec | undefined {
  const holders = rolesThatCan(kit, capability);
  return named ? holders.find((role) => role.role === named) : holders[0];
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

/**
 * Paseo's own agent-facing tools, copied by hand because the SDK exports no list.
 *
 * A role's `allow` is turned into a denial of everything NOT on it, so this list is load-bearing in
 * two directions and fails differently in each. A name in `allow` that is not here denies the role
 * every Paseo tool — see the check in resolveRole, which turns that into a settings error instead of
 * a silence. A tool Paseo adds that is not here is *enabled* for every role using `allow`, silently,
 * which is the direction that cannot be caught from inside: keep this in step with Paseo, and treat
 * a version bump as a reason to re-read it.
 */
export const PASEO_TOOLS = [
  "create_workspace", "list_workspaces", "archive_workspace", "create_agent", "send_agent_prompt", "get_agent_status",
  "list_agents", "cancel_agent", "archive_agent", "kill_agent", "update_agent", "rename_workspace", "list_workspace_scripts",
  "start_workspace_script", "stop_workspace_script", "list_terminals", "create_terminal", "kill_terminal", "capture_terminal",
  "send_terminal_keys", "create_schedule", "create_heartbeat", "delete_heartbeat", "list_schedules", "inspect_schedule",
  "pause_schedule", "resume_schedule", "delete_schedule", "update_schedule", "schedule_logs", "run_schedule_once",
  "list_providers", "list_models", "list_profiles", "inspect_provider", "get_agent_activity", "set_agent_mode",
  "list_pending_permissions", "respond_to_permission",
];

export function paseoToolsPolicy(role: RoleSpec): { enabled?: boolean; disabledTools?: string[] } | undefined {
  const policy = role.paseoTools;
  if (!policy) return undefined;
  if (policy.allow) return { disabledTools: PASEO_TOOLS.filter((tool) => !policy.allow!.includes(tool)) };
  const { allow: _allow, ...rest } = policy;
  return rest;
}

export function teamServer(kit: Kit, role: RoleSpec, spool: string, node: string): McpServers {
  if (!role.tools) return {};
  return { team: { type: "stdio", command: node, args: [join(kit.dir, "mcp", "team.mjs"), role.role, role.tools, spool] } };
}
