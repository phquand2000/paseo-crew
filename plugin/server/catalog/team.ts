import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Attention,
  type HarnessSpec,
  type Kit,
  type McpEntry,
  type McpServers,
  type McpTransport,
  type ModelSpec,
  type ProxySpec,
  type RoleSpec,
  PASEO_TOOLS,
  supportsRole,
  teamServer,
} from "./kit.ts";
import type { Connect, Layer, McpChoice } from "./settings.ts";

export type SettingValue = string | number | boolean;
export type McpState = {
  id: string;
  label: string;
  entry?: McpEntry;
  connect?: Connect;
  rule?: string;
  tools?: Record<string, string[]>;
  enabled: boolean;
  roles: string[];
  settings: Record<string, SettingValue>;
};
export type RoleSeat = { role: RoleSpec; harness: HarnessSpec; model?: ModelSpec; thinking?: string; rules: string; mcp: string[] };
export type Team = {
  roles: Record<string, RoleSeat>;
  mcp: Record<string, McpState>;
  attention: Attention;
  rules: string;
  errors: string[];
};

export function templateRoles(entry: McpEntry): string[] {
  return entry.kind === "proxy" ? Object.keys(entry.tools ?? {}) : (entry.roles ?? []);
}

export function eligibleRoles(state: McpState, kit: Kit): string[] {
  const entry = state.entry;
  if (entry?.kind === "proxy") return Object.keys(state.tools ?? entry.tools ?? {});
  if (entry) return entry.roles ?? kit.roles.filter((role) => role.tools).map((role) => role.role);
  return kit.roles.filter((role) => role.tools).map((role) => role.role);
}

export function transportOf(state: McpState): McpTransport {
  if (state.entry?.kind === "proxy") return "stdio";
  return state.connect?.type ?? (state.entry?.server?.type as McpTransport | undefined) ?? "stdio";
}

export function connectToServer(connect: Connect): Record<string, unknown> | undefined {
  if (connect.type === "stdio") {
    const [command, ...args] = connect.command ?? [];
    if (!command) return undefined;
    return { type: "stdio", command, ...(args.length > 0 ? { args } : {}), ...(connect.env ? { env: connect.env } : {}) };
  }
  if (!connect.url) return undefined;
  return { type: connect.type, url: connect.url, ...(connect.headers ? { headers: connect.headers } : {}) };
}

export function fill(template: string, settings: Record<string, SettingValue>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in settings ? String(settings[key]) : whole));
}

function resolveMcp(kit: Kit, layers: Layer[], errors: string[]): Record<string, McpState> {
  const states: Record<string, McpState> = {};
  const ids = new Set([...Object.keys(kit.mcp), ...layers.flatMap((layer) => Object.keys(layer.mcp ?? {}))]);
  for (const id of ids) {
    const entry = kit.mcp[id];
    const choices = layers.map((layer) => layer.mcp?.[id]).filter((choice): choice is McpChoice => choice !== undefined);
    const settings: Record<string, SettingValue> = {};
    for (const [key, spec] of Object.entries(entry?.settings ?? {})) if (spec.default !== undefined) settings[key] = spec.default;
    let enabled = entry?.defaults.enabled ?? false;
    let removed = false;
    let label = entry?.label ?? id;
    let connect: Connect | undefined;
    let rule: string | undefined;
    let tools = entry?.tools;
    let roles: string[] | undefined;
    for (const choice of choices) {
      if (choice.enabled !== undefined) enabled = choice.enabled;
      if (choice.removed !== undefined) removed = choice.removed;
      if (choice.label) label = choice.label;
      if (choice.connect) connect = choice.connect;
      if (choice.rule !== undefined) rule = choice.rule;
      if (choice.tools) tools = { ...tools, ...choice.tools };
      if (choice.roles) roles = choice.roles;
      for (const [key, value] of Object.entries(choice.settings ?? {})) {
        const spec = entry?.settings[key];
        if (!spec) errors.push(`${label} has no setting named ${key}`);
        else if (typeof value !== spec.type) errors.push(`${label} setting ${key} must be a ${spec.type}`);
        else settings[key] = value;
      }
    }
    if (removed) continue;
    if (!entry && !connect) {
      errors.push(`The MCP server ${id} has nothing to connect to; paste its connection details or remove it`);
      continue;
    }
    const state: McpState = { id, label, entry, connect, rule, tools, enabled, roles: [], settings };
    const eligible = eligibleRoles(state, kit);
    for (const role of roles ?? []) {
      if (!eligible.includes(role)) errors.push(`${label} can't be given to the ${role} role: it has nothing for that role`);
    }
    state.roles = (roles ?? eligible).filter((role) => eligible.includes(role));
    states[id] = state;
  }
  return states;
}

function resolveRole(kit: Kit, role: RoleSpec, layers: Layer[], mcp: Record<string, McpState>, errors: string[]): RoleSeat | undefined {
  let choice: { harness: string; model?: string; thinking?: string } = { ...role.defaults };
  const ownRules: string[] = [];
  for (const layer of layers) {
    const next = layer.roles?.[role.role];
    if (!next) continue;
    if (next.harness && next.harness !== choice.harness) choice = { harness: next.harness };
    if (next.model) choice.model = next.model;
    if (next.thinking) choice.thinking = next.thinking;
    if (next.rules?.trim()) ownRules.push(next.rules.trim());
  }
  if (role.tools && !kit.toolSets[role.tools]) {
    errors.push(
      `The ${role.label} is given the tool set ${role.tools}, which this kit does not have. A seat with no tools starts, offers none and can never answer; the sets it can be given are ${Object.keys(kit.toolSets).sort().join(", ") || "none"}.`,
    );
  }
  const unknownTools = (role.paseoTools?.allow ?? []).filter((tool) => !PASEO_TOOLS.includes(tool));
  if (unknownTools.length > 0) {
    errors.push(
      `The ${role.label} is allowed Paseo tools this kit does not know: ${unknownTools.join(", ")}. An allow list is applied by denying everything else, so an unknown name denies the ${role.label} every Paseo tool rather than granting it one.`,
    );
  }
  const harness = kit.harnesses[choice.harness];
  if (!harness) {
    errors.push(`The ${role.label} runs on ${choice.harness}, which is not in the harness catalog`);
    return undefined;
  }
  if (!supportsRole(kit, harness, role)) {
    errors.push(`${harness.label} has no ${role.role} settings under harness/${harness.id}/settings, so it can't run the ${role.label}`);
  }
  const models = harness.models ?? [];
  // The catalog is what the settings screen offers, not a fence. Which model a seat runs is the owner's
  // choice, and the evidence for several lenses is about different models, not one model resampled.
  let model = choice.model ? (models.find((entry) => entry.id === choice.model) ?? { id: choice.model, label: choice.model }) : undefined;
  model ??= models.find((entry) => entry.isDefault) ?? models[0];
  let thinking: string | undefined;
  const options = harness.hasThinking === false ? [] : (model?.thinkingOptions ?? []);
  if (options.length > 0) {
    if (choice.thinking && !options.some((option) => option.id === choice.thinking)) {
      errors.push(`${model!.label} on ${harness.label} has no thinking option ${choice.thinking} for the ${role.label}`);
    }
    thinking = options.some((option) => option.id === choice.thinking) ? choice.thinking : (options.find((option) => option.isDefault) ?? options[0])!.id;
  }
  const enabled = Object.values(mcp)
    .filter((state) => state.enabled && state.roles.includes(role.role))
    .sort((a, b) => (a.entry?.order ?? 100) - (b.entry?.order ?? 100))
    .map((state) => state.id);
  for (const id of enabled) {
    const transport = transportOf(mcp[id]!);
    if (!harness.mcp.transports.includes(transport)) {
      errors.push(`${harness.label} can't reach ${mcp[id]!.label} over ${transport}, so the ${role.label} can't use it`);
    }
  }
  return { role, harness, model, thinking, rules: ownRules.join("\n\n"), mcp: enabled };
}

export function resolveTeam(kit: Kit, machine: Layer = {}, project: Layer = {}): Team {
  const errors: string[] = [];
  const layers = [machine, project];
  layers.forEach((layer, index) => {
    const where = index === 0 ? "The machine settings" : "The project settings";
    for (const name of Object.keys(layer.roles ?? {})) if (!kit.roles.some((role) => role.role === name)) errors.push(`${where} name an unknown role ${name}`);
  });
  const mcp = resolveMcp(kit, layers, errors);
  const roles: Record<string, RoleSeat> = {};
  for (const role of kit.roles) {
    const seat = resolveRole(kit, role, layers, mcp, errors);
    if (seat) roles[role.role] = seat;
  }
  return {
    roles,
    mcp,
    attention: { ...kit.attention, ...stripUndefined(machine.attention), ...stripUndefined(project.attention) },
    rules: [machine.rules, project.rules].filter((text) => text && text.trim()).join("\n\n"),
    errors,
  };
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

export function withHarness(team: Team, roleName: string, harness: HarnessSpec): Team {
  const seat = team.roles[roleName];
  if (!seat || seat.harness.id === harness.id) return team;
  const models = harness.models ?? [];
  const model = models.find((entry) => entry.isDefault) ?? models[0];
  const options = harness.hasThinking === false ? [] : (model?.thinkingOptions ?? []);
  const thinking = (options.find((option) => option.isDefault) ?? options[0])?.id;
  return { ...team, roles: { ...team.roles, [roleName]: { ...seat, harness, model, thinking } } };
}

export type IndexedProxy = ProxySpec & { id: string; label: string; backend: { type: "http"; url: string } };

export function proxyOf(state: McpState): ProxySpec | undefined {
  return state.entry?.proxy ? (JSON.parse(fill(JSON.stringify(state.entry.proxy), state.settings)) as ProxySpec) : undefined;
}

export function indexedProxies(team: Team): IndexedProxy[] {
  const found: IndexedProxy[] = [];
  for (const state of Object.values(team.mcp)) {
    const proxy = state.enabled ? proxyOf(state) : undefined;
    if (proxy?.open && proxy.backend.type === "http") found.push({ ...proxy, backend: proxy.backend, id: state.id, label: state.label });
  }
  return found;
}

export function serversFor(kit: Kit, team: Team, roleName: string, context: { node: string; spool: string }): McpServers {
  const seat = team.roles[roleName];
  if (!seat) return {};
  const servers: McpServers = { ...teamServer(kit, seat.role, context.spool, context.node) };
  for (const id of seat.mcp) {
    const state = team.mcp[id]!;
    const { entry } = state;
    if (entry?.kind === "proxy") {
      const tools = (state.tools ?? entry.tools)?.[roleName] ?? [];
      if (tools.length === 0) continue;
      const config = { name: id, label: state.label, instructions: entry.instructions ?? "", tools, ...proxyOf(state) };
      servers[id] = { type: "stdio", command: context.node, args: [join(kit.dir, "mcp", "code.mjs"), JSON.stringify(config)] };
      continue;
    }
    const shaped = state.connect ? connectToServer(state.connect) : entry?.server ? JSON.parse(fill(JSON.stringify(entry.server), state.settings)) : undefined;
    if (shaped) servers[id] = shaped;
  }
  return servers;
}

export function rulesFor(team: Team, roleName: string): string {
  const seat = team.roles[roleName];
  if (!seat) return "";
  const parts: string[] = [];
  for (const id of seat.mcp) {
    const state = team.mcp[id]!;
    const { entry } = state;
    const lines: string[] = [];
    const rule = state.rule ?? (entry?.rule ? readFileSync(join(entry.dir, entry.rule), "utf-8").trim() : "");
    if (rule.trim()) lines.push(rule.trim());
    const tools = entry?.kind === "proxy" ? ((state.tools ?? entry.tools)?.[roleName] ?? []) : [];
    if (tools.length > 0) lines.push(`Your ${state.label} tools: ${tools.map((tool) => `\`${tool}\``).join(", ")}.`);
    const note = entry?.roleNotes?.[roleName];
    if (note) lines.push(note);
    if (lines.length > 0) parts.push(lines.join("\n\n"));
  }
  if (seat.harness.mcp.rule && seat.mcp.length > 0) parts.push(seat.harness.mcp.rule);
  if (team.rules) parts.push(`## Rules from the Human\n\n${team.rules.trim()}`);
  if (seat.rules) parts.push(`## Rules from the Human, for the ${seat.role.label}\n\n${seat.rules}`);
  return parts.length > 0 ? `# Working rules\n\n${parts.join("\n\n")}\n` : "";
}

export function skillDirsFor(team: Team, roleName: string): Map<string, string> {
  const found = new Map<string, string>();
  const seat = team.roles[roleName];
  if (!seat) return found;
  for (const id of seat.mcp) {
    const { entry } = team.mcp[id]!;
    if (entry) for (const skill of entry.skills ?? []) found.set(skill, join(entry.dir, "skills", skill));
  }
  return found;
}
