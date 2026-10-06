import type { Layer, RoleChoice } from "../../../shared/settings.ts";
import { supportsRole } from "../kit/harness-files.ts";
import type { HarnessSpec, Kit, ModelSpec, RoleSpec } from "../kit/kit.ts";
import { type McpState, transportOf } from "./mcp-states.ts";
import { agentDefault } from "../kit/roles.ts";

/** What a role's seats run: a harness, model and thinking, the Human's rules for the role, what it skips and its MCP servers. */
export type RoleSeat = {
  role: RoleSpec;
  harness: HarnessSpec;
  model?: ModelSpec;
  thinking?: string;
  rules: string;
  skips: NonNullable<RoleChoice["skips"]>;
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
  const { choice, rules, skips } = chosen(role, layers, origin);
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
  return { role, harness, model, thinking, rules, skips, mcp: serversFor(role, harness, mcp, errors) };
}

/** What a role runs on a harness its seat is not on: its preset for that harness, else that harness's default. */
export function presetOn(
  role: RoleSpec,
  harness: HarnessSpec,
  roles: RoleSpec[],
): { model?: ModelSpec; thinking?: string } {
  const preset = presetOf(role, harness.id);
  // The kit's own model for its own harness, whether or not the catalog lists it, as resolveRole keeps it.
  const model = modelFor(harness, preset?.model, roles);
  return { model, thinking: thinkingFor(harness, model, preset?.thinking) };
}

/** The role's defaults on its own harness, else its preset for the harness if it has one. */
function presetOf(role: RoleSpec, harness: string): Omit<Choice, "harness"> | undefined {
  return harness === role.defaults.harness ? role.defaults : role.presets?.[harness];
}

/** The model named, listed or not, since which model a seat runs is the owner's choice; else another role's preset or Paseo's first. */
function modelFor(harness: HarnessSpec, id: string | undefined, roles: RoleSpec[]): ModelSpec | undefined {
  if (!id) return agentDefault(roles, harness);
  return (harness.models ?? []).find((entry) => entry.id === id) ?? { id, label: id };
}

/** The thinking chosen where the model offers it, else its default; a model the catalog does not list keeps the choice, as no options listed is not a list of none. */
function thinkingFor(
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
/** The project's list of what a role skips replaces the machine's, so a project can clear it with an empty one. */
function chosen(
  role: RoleSpec,
  layers: Layer[],
  origin: Choice,
): Pick<RoleSeat, "rules" | "skips"> & { choice: Choice } {
  let choice: Choice = { ...origin };
  const rules: string[] = [];
  let skips: RoleSeat["skips"] = [];
  for (const next of layers.map((layer) => layer.roles?.[role.role])) {
    if (!next) continue;
    // Back on the role's own harness restores the preset; another harness starts from the role's preset there.
    if (next.harness && next.harness !== choice.harness)
      choice =
        next.harness === origin.harness ? { ...origin } : { harness: next.harness, ...role.presets?.[next.harness] };
    if (next.model) choice.model = next.model;
    if (next.thinking) choice.thinking = next.thinking;
    if (next.rules?.trim()) rules.push(next.rules.trim());
    if (next.skips) skips = next.skips;
  }
  return { choice, rules: rules.join("\n\n"), skips };
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
