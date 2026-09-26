import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gitCommonDir } from "../core/git.ts";
import { gitRoot } from "../desk/project.ts";
import type { Paths } from "../../shared/views.ts";

/** A folder and the folders in it, for the panel's picker: which are repositories, and the project a subfolder is in. */
export function listFolders(path?: string): Paths {
  const asked = path && path.trim() ? path.trim() : homedir();
  let here: string;
  try {
    here = realpathSync(asked);
    if (!statSync(here).isDirectory()) return { error: `${asked} is not a directory on this machine.` };
  } catch {
    return { error: `${asked} is not a directory on this machine.` };
  }
  const parent = dirname(here);
  let children: string[];
  try {
    // Listable is not readable; the screen handles a refusal but not a rejected promise.
    children = readdirSync(here, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(here, entry.name));
  } catch {
    return { error: `${asked} is on this machine but could not be read.` };
  }
  // One stat per child, not a git process: hundreds of spawns block the loop serving the seats' tool calls.
  const looksLikeRepo = (child: string) => existsSync(join(child, ".git"));
  const folders = children
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 300)
    .map((child) => ({ name: child.slice(here.length + 1), path: child, repository: looksLikeRepo(child) }));
  // True in subdirectories too; the root is named so browsing `/repo/src` shows `/repo` is already a project.
  const root = gitRoot(here);
  return {
    path: here,
    parent: parent === here ? null : parent,
    repository: Boolean(gitCommonDir(here)),
    root: root === here ? null : root,
    folders,
  };
}
