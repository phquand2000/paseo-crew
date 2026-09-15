import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ThinkingSpec = { id: string; label: string; isDefault?: boolean };
export type ModelSpec = { id: string; label: string; isDefault?: boolean; thinkingOptions?: ThinkingSpec[] };
export type McpServers = Record<string, unknown>;
export type TeamRole = "supervisor" | "lead" | "peer" | "reviewer";

export type RoleSpec = {
  role: string;
  label: string;
  description?: string;
  harness: string;
  team?: TeamRole;
  headless?: boolean;
  byHarness: Record<string, { models?: ModelSpec[]; thinking?: string }>;
  prompt: string;
  skills: string | null;
  extraSkills?: string[];
  extraMcpServers?: McpServers;
  paseoTools?: { enabled?: boolean; disabledTools?: string[]; allow?: string[] };
  entry?: boolean;
  hidesWords?: string[];
};

export type HarnessSpec = {
  id: string;
  label: string;
  baseProvider: string;
  configDirEnv: string;
  profileRoot: string;
  promptFile?: string;
  skillsDir: string;
  hasThinking?: boolean;
  systemPrompt?: "config" | "file";
  stateAccess?: "sandboxAllowWrite";
  settings: { mode: "link" | "merge"; file: string; source: string; roleSource?: string; ownedPaths?: string[] };
  links?: { link: string; target: string; optional?: boolean }[];
  state?: { file: string; seed?: string };
  provider: { env?: Record<string, string>; profileModeId?: string; command?: string[] };
  headless?: string[];
};

export type Attention = {
  tickSeconds: number;
  leadIdleMinutes: number;
  askRemindMinutes: number;
  maxReminders: number;
  watcherDebounceSeconds: number;
  watcherTimeoutSeconds: number;
};

export type Limits = { lanes: number; tasksPerLane: number };

export type Kit = {
  dir: string;
  prefix: string;
  roles: RoleSpec[];
  harnesses: Record<string, HarnessSpec>;
  mcpServers: McpServers;
  attention: Attention;
  limits: Limits;
};

const ATTENTION: Attention = { tickSeconds: 30, leadIdleMinutes: 12, askRemindMinutes: 15, maxReminders: 2, watcherDebounceSeconds: 45, watcherTimeoutSeconds: 180 };
const LIMITS: Limits = { lanes: 3, tasksPerLane: 4 };

export function loadKit(dir: string): Kit {
  const raw = JSON.parse(readFileSync(join(dir, "roles.json"), "utf-8"));
  const harnesses: Record<string, HarnessSpec> = {};
  const harnessRoot = join(dir, "harness");
  for (const id of readdirSync(harnessRoot)) {
    const file = join(harnessRoot, id, "harness.json");
    if (existsSync(file)) harnesses[id] = JSON.parse(readFileSync(file, "utf-8")) as HarnessSpec;
  }
  const roles = (raw.roles ?? raw.seats ?? []) as RoleSpec[];
  for (const role of roles) {
    if (!harnesses[role.harness]) {
      throw new Error(`role ${role.role} runs on harness ${role.harness}, which has no harness/${role.harness}/harness.json`);
    }
  }
  return {
    dir,
    prefix: typeof raw.providerPrefix === "string" ? raw.providerPrefix : "",
    roles,
    harnesses,
    mcpServers: (raw.mcpServers ?? {}) as McpServers,
    attention: { ...ATTENTION, ...(raw.attention ?? {}) },
    limits: { ...LIMITS, ...(raw.limits ?? {}) },
  };
}

export function providerId(kit: Kit, role: string): string {
  return `${kit.prefix}${role}`;
}

export function roleOf(kit: Kit, provider: string | null | undefined): RoleSpec | undefined {
  if (!provider) return undefined;
  const id = provider.split("/")[0] ?? "";
  if (!id.startsWith(kit.prefix)) return undefined;
  const name = id.slice(kit.prefix.length);
  return kit.roles.find((role) => role.role === name && !role.headless);
}

export function roleNamed(kit: Kit, name: string): RoleSpec | undefined {
  return kit.roles.find((role) => role.role === name);
}

export function seatRoles(kit: Kit): RoleSpec[] {
  return kit.roles.filter((role) => !role.headless);
}

export function harnessOf(kit: Kit, role: RoleSpec): HarnessSpec {
  const harness = kit.harnesses[role.harness];
  if (!harness) throw new Error(`role ${role.role} runs on unknown harness ${role.harness}`);
  return harness;
}

export function modelsOf(role: RoleSpec): ModelSpec[] {
  return role.byHarness[role.harness]?.models ?? [];
}

function pickDefault<T extends { isDefault?: boolean }>(list: T[]): T | undefined {
  return list.find((item) => item.isDefault) ?? list[0];
}

export function defaultModel(role: RoleSpec): ModelSpec | undefined {
  return pickDefault(modelsOf(role));
}

export function defaultThinking(role: RoleSpec, model: ModelSpec | undefined): string | undefined {
  return pickDefault(model?.thinkingOptions ?? [])?.id ?? role.byHarness[role.harness]?.thinking;
}

export function entryRole(kit: Kit): RoleSpec | undefined {
  return kit.roles.find((role) => role.entry);
}

export function roleWithTeam(kit: Kit, team: TeamRole): RoleSpec | undefined {
  return kit.roles.find((role) => role.team === team);
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

export function mcpServersFor(kit: Kit, role: RoleSpec, team: McpServers = {}): McpServers {
  return { ...kit.mcpServers, ...(role.extraMcpServers ?? {}), ...team };
}
