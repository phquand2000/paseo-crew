import type { Kit } from "../catalog/kit.ts";
import { supportsRole } from "../catalog/harness-files.ts";
import { templateRoles } from "../catalog/mcp-states.ts";
import type { CatalogView } from "../../shared/views.ts";

/** The kit as the panel reads it: roles, agents, servers, and the sensors the watch can be judged by. */
export function describeCatalog(kit: Kit): CatalogView {
  return {
    roles: kit.roles.map((role) => ({
      id: role.role,
      label: role.label,
      description: role.description ?? "",
      can: role.can ?? [],
      concern: role.concern ?? null,
      defaults: role.defaults,
      follows: role.follows ?? null,
      harnesses: Object.values(kit.harnesses)
        .filter((harness) => supportsRole(kit, harness, role))
        .map((harness) => harness.id),
    })),
    harnesses: Object.values(kit.harnesses).map((harness) => ({
      id: harness.id,
      label: harness.label,
      models: harness.models ?? [],
      transports: harness.mcp.transports,
    })),
    mcp: Object.values(kit.mcp)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        description: entry.description ?? "",
        kind: entry.kind,
        transport: entry.kind === "proxy" ? "stdio" : (entry.server?.type ?? "stdio"),
        settings: entry.settings,
        defaults: entry.defaults,
        roles: templateRoles(entry),
      })),
    sensors: Object.values(kit.sensors).map((sensor) => ({
      id: sensor.id,
      label: sensor.label,
      key: sensor.key,
      model: sensor.model,
      terms: sensor.terms,
    })),
  };
}
