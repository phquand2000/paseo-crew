import type { ArgSchema, HarnessSpec, Kit, ModelSpec, RoleSpec } from "./kit.ts";

export function providerId(kit: Kit, role: string, harness: string): string {
  return `${kit.prefix}${role}-${harness}`;
}

export function seatOf(
  kit: Kit,
  provider: string | null | undefined,
): { role: RoleSpec; harness: HarnessSpec } | undefined {
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

/** Another role's preset for this agent, else Paseo's first: Paseo's own default cannot be read back, since the plugin sets it. */
export function agentDefault(roles: RoleSpec[], harness: HarnessSpec): ModelSpec | undefined {
  const models = harness.models ?? [];
  const preset = roles
    .map((role) => role.defaults)
    .find(
      (defaults) =>
        defaults.harness === harness.id && defaults.model && models.some((entry) => entry.id === defaults.model),
    );
  return models.find((entry) => entry.id === preset?.model) ?? models[0];
}
