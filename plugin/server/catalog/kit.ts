import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ThinkingSpec = { id: string; label: string; isDefault?: boolean };
export type ModelSpec = { id: string; label: string; isDefault?: boolean; thinkingOptions?: ThinkingSpec[] };
export type McpServers = Record<string, unknown>;
export type TeamRole = "supervisor" | "lead" | "peer" | "reviewer";
export type McpTransport = "stdio" | "http" | "sse";

export type RoleSpec = {
  role: string;
  label: string;
  description?: string;
  team?: TeamRole;
  headless?: boolean;
  entry?: boolean;
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
  systemPrompt?: "config" | "file";
  stateWrites?: string;
  refused?: string;
  settings: { file: string; source: string; roleSource: string; ownedPaths?: string[] };
  links?: { link: string; target: string; optional?: boolean }[];
  models?: ModelSpec[];
  mcp: {
    file: string;
    delivery: "launch" | "file";
    transports: McpTransport[];
    seed?: Record<string, unknown>;
    key?: string;
    shape?: Partial<Record<McpTransport, unknown>>;
    clear?: { set?: Record<string, unknown>; remove?: string[]; setInEach?: Record<string, Record<string, unknown>> };
    rule?: string;
  };
  provider: { env?: Record<string, string>; profileModeId?: string; command?: string[]; forceFlags?: Record<string, string> };
  headless?: string[];
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
  "systemPrompt",
  "stateWrites",
  "refused",
  "settings",
  "links",
  "models",
  "mcp",
  "provider",
  "headless",
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
};

export type Attention = {
  tickSeconds: number;
  leadIdleMinutes: number;
  askRemindMinutes: number;
  maxReminders: number;
  watcherDebounceSeconds: number;
  watcherTimeoutSeconds: number;
};

export type Limits = { slots: number; tasksPerLane: number };

export type Kit = {
  dir: string;
  prefix: string;
  roles: RoleSpec[];
  harnesses: Record<string, HarnessSpec>;
  mcp: Record<string, McpEntry>;
  attention: Attention;
  limits: Limits;
};

const ATTENTION: Attention = { tickSeconds: 30, leadIdleMinutes: 12, askRemindMinutes: 15, maxReminders: 2, watcherDebounceSeconds: 45, watcherTimeoutSeconds: 180 };
const LIMITS: Limits = { slots: 3, tasksPerLane: 4 };

function subdirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
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
    if (raw.rule && !existsSync(join(root, id, raw.rule))) throw new Error(`MCP ${id} names rule ${raw.rule}, which is missing`);
    for (const skill of raw.skills ?? []) {
      if (!existsSync(join(root, id, "skills", skill, "SKILL.md"))) throw new Error(`MCP ${id} names skill ${skill}, but its SKILL.md is missing`);
    }
    entries[id] = { ...raw, settings: raw.settings ?? {}, defaults: { enabled: raw.defaults?.enabled ?? false }, dir: join(root, id) };
  }
  return entries;
}

export function loadKit(dir: string): Kit {
  const raw = JSON.parse(readFileSync(join(dir, "roles.json"), "utf-8"));
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
    attention: { ...ATTENTION, ...(raw.attention ?? {}) },
    limits: { ...LIMITS, ...(raw.limits ?? {}) },
  };
}

export function providerId(kit: Kit, role: string, harness: string): string {
  return `${kit.prefix}${role}-${harness}`;
}

export function seatOf(kit: Kit, provider: string | null | undefined): { role: RoleSpec; harness: HarnessSpec } | undefined {
  if (!provider) return undefined;
  const id = provider.split("/")[0] ?? "";
  if (!id.startsWith(kit.prefix)) return undefined;
  for (const role of seatRoles(kit)) {
    for (const harness of Object.values(kit.harnesses)) {
      if (id === providerId(kit, role.role, harness.id)) return { role, harness };
    }
  }
  return undefined;
}

export function hookTools(proxy: ProxySpec | undefined): string[] {
  return [proxy?.open?.tool, proxy?.wait?.tool, proxy?.sync?.tool].filter((name): name is string => Boolean(name));
}

export function roleNamed(kit: Kit, name: string): RoleSpec | undefined {
  return kit.roles.find((role) => role.role === name);
}

export function seatRoles(kit: Kit): RoleSpec[] {
  return kit.roles.filter((role) => !role.headless);
}

export function headlessRole(kit: Kit): RoleSpec | undefined {
  return kit.roles.find((role) => role.headless);
}

export function entryRole(kit: Kit): RoleSpec | undefined {
  return kit.roles.find((role) => role.entry);
}

export function roleWithTeam(kit: Kit, team: TeamRole): RoleSpec | undefined {
  return kit.roles.find((role) => role.team === team);
}

export function roleSettingsFile(kit: Kit, harness: HarnessSpec, role: RoleSpec): string {
  return join(kit.dir, "harness", harness.id, harness.settings.roleSource.replace("ROLE", role.role));
}

export function supportsRole(kit: Kit, harness: HarnessSpec, role: RoleSpec): boolean {
  return existsSync(roleSettingsFile(kit, harness, role));
}

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
  if (!role.team) return {};
  return { team: { type: "stdio", command: node, args: [join(kit.dir, "mcp", "team.mjs"), role.team, spool] } };
}
