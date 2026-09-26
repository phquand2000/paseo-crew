import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { can } from "../../catalog/kit/roles.ts";
import type { RoleSpec } from "../../catalog/kit/kit.ts";
import { gitCommonDir } from "../../core/git.ts";
import { type Project, loadConfig } from "./project.ts";

/** Why `rel` cannot name a path inside the project's own checkout, or undefined when it can. */
export function pathProblem(root: string, rel: string): string | undefined {
  if (!rel || isAbsolute(rel)) return "is not a path relative to the project";
  const clean = normalize(rel);
  if (clean === "." || clean.split(/[\\/]/).includes("..")) return "leaves the project";
  const path = join(root, clean);
  if (!existsSync(path)) return "does not exist in the project";
  const home = realpathSync(root);
  const real = realpathSync(path);
  if (real !== home && !real.startsWith(home + sep)) return "resolves outside the project";
  return undefined;
}

/** The Human's `writable` paths, resolved: a sandbox checks the real path, not a lane copy's link to it. */
export function projectWrites(project: Project): string[] {
  return loadConfig(project.state)
    .writable.filter((rel) => !pathProblem(project.root, rel))
    .map((rel) => realpathSync(join(project.root, normalize(rel))));
}

/** What a seat writes beyond state: the Human's `writable`, and for a role that commits, the git directory a lane copy keeps its index in. */
export function seatWrites(role: RoleSpec, project: Project): string[] {
  const common = can(role, "work") || can(role, "write") ? gitCommonDir(project.root) : undefined;
  return [...projectWrites(project), ...(common ? [common] : [])];
}
