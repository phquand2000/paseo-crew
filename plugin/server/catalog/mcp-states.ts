import type { Connect, Layer, McpChoice, Scalar } from "../../shared/settings.ts";
import type { Kit, McpEntry, McpTransport } from "./kit.ts";
import { PASEO_SERVER, TEAM_SERVER } from "./kit.ts";
import { can } from "./roles.ts";

/** An MCP server as the settings leave it: on or off, for which roles, and how it connects. */
export type McpState = {
  id: string;
  label: string;
  entry?: McpEntry;
  connect?: Connect;
  rule?: string;
  tools?: Record<string, string[]>;
  enabled: boolean;
  roles: string[];
  settings: Record<string, Scalar>;
};

export function templateRoles(entry: McpEntry): string[] {
  return entry.kind === "proxy" ? Object.keys(entry.tools ?? {}) : (entry.roles ?? []);
}

export function transportOf(state: McpState): McpTransport {
  if (state.entry?.kind === "proxy") return "stdio";
  return state.connect?.type ?? state.entry?.server?.type ?? "stdio";
}

/** Every server the kit ships or a layer adds, each layer's choice over the last; `errors` gets what could not apply. */
export function resolveMcp(kit: Kit, layers: Layer[], errors: string[]): Record<string, McpState> {
  const states: Record<string, McpState> = {};
  const ids = new Set([...Object.keys(kit.mcp), ...layers.flatMap((layer) => Object.keys(layer.mcp ?? {}))]);
  for (const id of ids) {
    const state = resolveServer(kit, id, layers, errors);
    if (state) states[id] = state;
  }
  return states;
}

function resolveServer(kit: Kit, id: string, layers: Layer[], errors: string[]): McpState | undefined {
  if (id === TEAM_SERVER || id === PASEO_SERVER) {
    errors.push(
      `The MCP server ${id} has the name of a server every seat already has, so it would replace that one; it is left out: paste it again under another name`,
    );
    return undefined;
  }
  const entry = kit.mcp[id];
  const enabled = entry?.defaults.enabled ?? false;
  const settings = defaultSettings(entry);
  const state: McpState = {
    id,
    label: entry?.label ?? id,
    entry,
    connect: undefined,
    rule: undefined,
    tools: entry?.tools,
    enabled,
    roles: [],
    settings,
  };
  let removed = false;
  let named: string[] | undefined;
  for (const choice of layers.map((layer) => layer.mcp?.[id])) {
    if (!choice) continue;
    removed = choice.removed ?? removed;
    named = choice.roles ?? named;
    applyChoice(state, choice, errors);
  }
  if (removed) return undefined;
  if (!entry && !state.connect) {
    errors.push(`The MCP server ${id} has nothing to connect to; paste its connection details or remove it`);
    return undefined;
  }
  state.roles = rolesOf(state, kit, named, errors);
  return state;
}

function defaultSettings(entry: McpEntry | undefined): Record<string, Scalar> {
  const settings: Record<string, Scalar> = {};
  for (const [key, spec] of Object.entries(entry?.settings ?? {}))
    if (spec.default !== undefined) settings[key] = spec.default;
  return settings;
}

/** One layer's choice over what the layers before it left; a setting the server lacks or of the wrong type is reported. */
function applyChoice(state: McpState, choice: McpChoice, errors: string[]): void {
  if (choice.enabled !== undefined) state.enabled = choice.enabled;
  if (choice.label) state.label = choice.label;
  if (choice.connect) state.connect = choice.connect;
  if (choice.rule !== undefined) state.rule = choice.rule;
  if (choice.tools) state.tools = { ...state.tools, ...choice.tools };
  for (const [key, value] of Object.entries(choice.settings ?? {})) {
    const spec = state.entry?.settings[key];
    if (!spec) errors.push(`${state.label} has no setting named ${key}`);
    else if (typeof value !== spec.type) errors.push(`${state.label} setting ${key} must be a ${spec.type}`);
    else state.settings[key] = value;
  }
}

/** No roles named means every role working with tools. */
function eligibleRoles(state: McpState, kit: Kit): string[] {
  const entry = state.entry;
  if (entry?.kind === "proxy") return Object.keys(state.tools ?? entry.tools ?? {});
  return entry?.roles ?? kit.roles.filter((role) => role.tools).map((role) => role.role);
}

/** The roles a server goes to: those named, where it can serve them, or else each it can serve but a judge, which answers from its case and the record. */
function rolesOf(state: McpState, kit: Kit, named: string[] | undefined, errors: string[]): string[] {
  const eligible = eligibleRoles(state, kit);
  for (const role of named ?? [])
    if (!eligible.includes(role))
      errors.push(`${state.label} can't be given to the ${role} role: it has nothing for that role`);
  const judges = (role: string) =>
    can(
      kit.roles.find((entry) => entry.role === role),
      "judge",
    );
  return (named ?? eligible.filter((role) => !judges(role))).filter((role) => eligible.includes(role));
}
