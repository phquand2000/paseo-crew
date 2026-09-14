import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ThinkingSpec = { id: string; label: string; isDefault?: boolean };
export type ModelSpec = { id: string; label: string; isDefault?: boolean; thinkingOptions?: ThinkingSpec[] };
export type McpServers = Record<string, unknown>;
export type Reports = "blocks" | "handback" | "attention";

export type RoleSpec = {
  role: string;
  label: string;
  description?: string;
  harness: string;
  byHarness: Record<string, { models?: ModelSpec[]; thinking?: string }>;
  prompt: string;
  skills: string | null;
  extraSkills?: string[];
  extraMcpServers?: McpServers;
  paseoTools?: { enabled?: boolean; disabledTools?: string[] };
  mayStart?: string[];
  entry?: boolean;
  hidesWords?: string[];
  reports?: Reports;
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
  settings: { mode: "link" | "merge"; file: string; source: string; roleSource?: string; ownedPaths?: string[] };
  links?: { link: string; target: string; optional?: boolean }[];
  state?: { file: string; seed?: string };
  provider: { env?: Record<string, string>; profileModeId?: string; command?: string[] };
};

export type Attention = {
  leadIdleMinutes: number;
  askRemindMinutes: number;
  maxReminders: number;
  tickSeconds: number;
};

export type Kit = {
  dir: string;
  prefix: string;
  roles: RoleSpec[];
  harnesses: Record<string, HarnessSpec>;
  mcpServers: McpServers;
  attention: Attention;
};

const ATTENTION: Attention = { leadIdleMinutes: 15, askRemindMinutes: 20, maxReminders: 3, tickSeconds: 60 };

export function loadKit(dir: string): Kit {
  const raw = JSON.parse(readFileSync(join(dir, "roles.json"), "utf-8"));
  const harnesses: Record<string, HarnessSpec> = {};
  const harnessRoot = join(dir, "harness");
  for (const id of readdirSync(harnessRoot)) {
    const file = join(harnessRoot, id, "harness.json");
    if (existsSync(file)) harnesses[id] = JSON.parse(readFileSync(file, "utf-8")) as HarnessSpec;
  }
  const roles = (raw.seats ?? raw.roles ?? []) as RoleSpec[];
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
  return kit.roles.find((role) => role.role === name);
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

export function mcpServersFor(kit: Kit, role: RoleSpec): McpServers {
  return { ...kit.mcpServers, ...(role.extraMcpServers ?? {}) };
}
