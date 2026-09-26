import { lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { git } from "../core/git.ts";
import { errorText } from "../core/errors.ts";
import type { DeskContext } from "./context.ts";
import { type Project, loadConfig, pathProblem } from "./project.ts";

/** Links the Human's uncommitted, git-ignored paths into a copy made from what is committed; anything else would leave it dirty. */
export async function placeLinks(ctx: DeskContext, project: Project, copy: { id: string; path: string }): Promise<void> {
  for (const rel of loadConfig(project.state).links) {
    const problem = pathProblem(project.root, rel);
    const path = problem ? rel : normalize(rel);
    const target = join(copy.path, path);
    let skipped = problem;
    if (!skipped && lstatSync(target, { throwIfNoEntry: false })) continue;
    // Asked before the link exists, so git judges it as the file a symlink is, never as a directory.
    if (!skipped && (await git(copy.path, ["check-ignore", "-q", "--", path])).code !== 0) skipped = "is not ignored by git, so the copy would count as changed";
    if (!skipped) {
      try {
        mkdirSync(dirname(target), { recursive: true });
        symlinkSync(join(project.root, path), target);
        continue;
      } catch (error) {
        skipped = `could not be linked: ${errorText(error)}`;
      }
    }
    ctx.log(project, `${rel} was not linked into working copy ${copy.id}: it ${skipped}`);
    ctx.event(project, { kind: "link.skipped", slot: copy.id, path: rel, why: skipped });
  }
}
