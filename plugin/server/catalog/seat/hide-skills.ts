import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expandHome } from "../../core/paths.ts";
import type { HarnessSpec } from "../kit/kit.ts";

/** Skills the agent would load from the owner's own roots, each turned off by its path: by name would hide the seat's own of that name too. */
export function hideSkillsSetting(harness: HarnessSpec, homeDir: string): Record<string, unknown> {
  const spec = harness.hideSkills;
  if (!spec) return {};
  const hidden = spec.roots.flatMap((root) => {
    const dir = expandHome(root, homeDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .sort()
      .map((name) => join(dir, name, "SKILL.md"))
      .filter((path) => existsSync(path))
      .map((path) => ({ path, enabled: false }));
  });
  if (hidden.length === 0) return {};
  return spec.setting.split(".").reduceRight<unknown>((value, key) => ({ [key]: value }), hidden) as Record<
    string,
    unknown
  >;
}
