import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HarnessSpec, Kit, RoleSpec } from "./kit.ts";

export function roleSettingsFile(kit: Kit, harness: HarnessSpec, role: RoleSpec): string {
  return join(kit.dir, "harness", harness.id, harness.settings.roleSource.replace("ROLE", role.role));
}

export function harnessFileSources(kit: Kit, harness: HarnessSpec, role: RoleSpec): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(harness.files ?? {}).map(([path, sources]) => [
      path,
      sources.map((source) => join(kit.dir, "harness", harness.id, source.replaceAll("ROLE", role.role))),
    ]),
  );
}

export function supportsRole(kit: Kit, harness: HarnessSpec, role: RoleSpec): boolean {
  return (
    existsSync(roleSettingsFile(kit, harness, role)) &&
    Object.values(harnessFileSources(kit, harness, role)).every((sources) =>
      sources.every((source) => existsSync(source)),
    )
  );
}

/** `allow` disables each of Paseo's tools it omits, so a tool Paseo adds that `catalog/paseo.json` lacks stays on: keep the list in step. */
export function paseoToolsPolicy(
  kit: Kit,
  role: RoleSpec,
): { enabled?: boolean; disabledTools?: string[] } | undefined {
  const policy = role.paseoTools;
  if (!policy) return undefined;
  if (policy.allow) return { disabledTools: kit.paseoTools.filter((tool) => !policy.allow!.includes(tool)) };
  const { allow: _allow, ...rest } = policy;
  return rest;
}
