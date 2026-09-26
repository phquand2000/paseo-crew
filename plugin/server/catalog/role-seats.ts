import type { Layer } from "../../shared/settings.ts";
import { supportsRole } from "./harness-files.ts";
import type { HarnessSpec, Kit, ModelSpec, RoleSpec } from "./kit.ts";
import { type McpState, transportOf } from "./mcp-states.ts";
import { agentDefault } from "./roles.ts";

/** What a role's seats run: a harness, model and thinking, the Human's rules for the role and its MCP servers. */
export type RoleSeat = {
  role: RoleSpec;
  harness: HarnessSpec;
  model?: ModelSpec;
  thinking?: string;
  rules: string;
  mcp: string[];
};

/** A harness and what runs on it, as a role's defaults or a settings layer name them. */
type Choice = { harness: string; model?: string; thinking?: string };

/** `origin` is where the role starts before any layer: its own defaults, or what the role it follows has in force. */
export function resolveRole(
  kit: Kit,
  role: RoleSpec,
  layers: Layer[],
  mcp: Record<string, McpState>,
  errors: string[],
  origin: Choice = role.defaults,
): RoleSeat | undefined {
  const { choice, rules } = chosen(role, layers, origin);
  checkTools(kit, role, errors);
  const harness = kit.harnesses[choice.harness];
  if (!harness) {
    errors.push(`The ${role.label} runs on ${choice.harness}, which is not in the harness catalog`);
    return undefined;
  }
  if (!supportsRole(kit, harness, role))
    errors.push(
      `${harness.label} has no ${role.role} settings under harness/${harness.id}/settings, so it can't run the ${role.label}`,
    );
  const model = modelFor(harness, choice.model, kit.roles);
  // Paseo refuses a bare provider before the daemon, which surfaced only as a format error at open_lane.
  if (!model)
    errors.push(
      `Paseo has listed no models for ${harness.label} yet and none is chosen for the ${role.label}; Paseo starts an agent only with one, so refresh the models or choose one`,
    );
  const options = model?.thinkingOptions ?? [];
  if (choice.thinking && options.length > 0 && !options.some((option) => option.id === choice.thinking))
    errors.push(`${model!.label} on ${harness.label} has no thinking option ${choice.thinking} for the ${role.label}`);
  const thinking = thinkingFor(harness, model, choice.thinking);
  return { role, harness, model, thinking, rules, mcp: serversFor(role, harness, mcp, errors) };
}

/** The model named, listed or not, since which model a seat runs is the owner's choice; else another role's preset or Paseo's first. */
export function modelFor(harness: HarnessSpec, id: string | undefined, roles: RoleSpec[]): ModelSpec | undefined {
  if (!id) return agentDefault(roles, harness);
  return (harness.models ?? []).find((entry) => entry.id === id) ?? { id, label: id };
}

/** The thinking chosen where the model offers it, else its default; a model the catalog does not list keeps the choice, as no options listed is not a list of none. */
export function thinkingFor(
  harness: HarnessSpec,
  model: ModelSpec | undefined,
  chosen: string | undefined,
): string | undefined {
  const options = model?.thinkingOptions ?? [];
  if (options.length === 0)
    return model && !(harness.models ?? []).some((entry) => entry.id === model.id) ? chosen : undefined;
  return options.some((option) => option.id === chosen)
    ? chosen
    : (options.find((option) => option.isDefault) ?? options[0])?.id;
}

/** The harness, model and thinking the layers leave the role on, and the Human's rules for it. */
function chosen(role: RoleSpec, layers: Layer[], origin: Choice): { choice: Choice; rules: string } {
  let choice: Choice = { ...origin };
  const rules: string[] = [];
  for (const next of layers.map((layer) => layer.roles?.[role.role])) {
    if (!next) continue;
    // Back on the role's own harness restores the preset; reset to the harness alone, it lost the preset's model and thinking.
    if (next.harness && next.harness !== choice.harness)
      choice = next.harness === origin.harness ? { ...origin } : { harness: next.harness };
    if (next.model) choice.model = next.model;
    if (next.thinking) choice.thinking = next.thinking;
    if (next.rules?.trim()) rules.push(next.rules.trim());
  }
  return { choice, rules: rules.join("\n\n") };
}

/** A tool set the kit lacks, or a Paseo tool it does not know, leaves the role's seats unable to answer. */
function checkTools(kit: Kit, role: RoleSpec, errors: string[]): void {
  if (role.tools && !kit.toolSets[role.tools]) {
    errors.push(
      `The ${role.label} is given the tool set ${role.tools}, which this kit does not have. A seat with no tools starts, offers none and can never answer; the sets it can be given are ${Object.keys(kit.toolSets).sort().join(", ") || "none"}.`,
    );
  }
  const unknown = (role.paseoTools?.allow ?? []).filter((tool) => !kit.paseoTools.includes(tool));
  if (unknown.length > 0) {
    errors.push(
      `The ${role.label} is allowed Paseo tools this kit does not know: ${unknown.join(", ")}. An allow list is applied by denying everything else, so an unknown name denies the ${role.label} every Paseo tool rather than granting it one.`,
    );
  }
}

/** The servers on for the role, in their order; one the harness cannot reach stays named, and is reported. */
function serversFor(role: RoleSpec, harness: HarnessSpec, mcp: Record<string, McpState>, errors: string[]): string[] {
  const enabled = Object.values(mcp)
    .filter((state) => state.enabled && state.roles.includes(role.role))
    .sort((a, b) => (a.entry?.order ?? 100) - (b.entry?.order ?? 100));
  for (const state of enabled) {
    const transport = transportOf(state);
    if (!harness.mcp.transports.includes(transport))
      errors.push(`${harness.label} can't reach ${state.label} over ${transport}, so the ${role.label} can't use it`);
  }
  return enabled.map((state) => state.id);
}
