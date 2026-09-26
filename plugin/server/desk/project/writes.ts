import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
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

/** Why `path` cannot be granted outside the project: it must be absolute, exist, and not hold the whole disk or home. */
export function outsideProblem(path: string, home = homedir()): string | undefined {
  if (!path || !isAbsolute(path)) return "is not an absolute path";
  if (!existsSync(path)) return "does not exist";
  const real = realpathSync(path);
  const within = (dir: string): boolean => dir === real || dir.startsWith(real.endsWith(sep) ? real : real + sep);
  if (within(existsSync(home) ? realpathSync(home) : home)) return "holds the home directory";
  return undefined;
}

/** The Human's `writable` paths, resolved: a sandbox checks the real path, not a lane copy's link to it. */
export function projectWrites(project: Project): string[] {
  return loadConfig(project.state)
    .writable.filter((rel) => !pathProblem(project.root, rel))
    .map((rel) => realpathSync(join(project.root, normalize(rel))));
}

/** The Human's `writableOutside` paths a role that writes code may also write, resolved. */
function outsideWrites(role: RoleSpec, project: Project): string[] {
  if (!can(role, "write")) return [];
  return loadConfig(project.state)
    .writableOutside.filter((path) => !outsideProblem(path))
    .map((path) => realpathSync(path));
}

/** Why `path` cannot be granted as a socket a seat may connect to: it must be absolute and name a unix socket. */
export function socketProblem(path: string): string | undefined {
  if (!path || !isAbsolute(path)) return "is not an absolute path";
  if (!existsSync(path)) return "does not exist";
  if (!statSync(path).isSocket()) return "is not a unix socket";
  return undefined;
}

/** The Human's `sockets` a role that writes code may connect to through its sandbox, resolved. */
export function seatSockets(role: RoleSpec, project: Project): string[] {
  if (!can(role, "write")) return [];
  return loadConfig(project.state)
    .sockets.filter((path) => !socketProblem(path))
    .map((path) => realpathSync(path));
}

/** What a seat writes beyond state: the Human's `writable`, for a role that writes code the Human's `writableOutside`, and for a role that commits the git directory a lane copy keeps its index in. */
export function seatWrites(role: RoleSpec, project: Project): string[] {
  const common = can(role, "work") || can(role, "write") ? gitCommonDir(project.root) : undefined;
  return [...projectWrites(project), ...outsideWrites(role, project), ...(common ? [common] : [])];
}
