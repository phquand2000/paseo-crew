import { uncommittedIn, uncommittedPaths } from "../../core/git.ts";

/** What a copy holds that no commit does, as "has work uncommitted (…)"; `untracked` false leaves the Human's own untracked files out. */
export async function unsavedIn(copy: string, untracked = true): Promise<string | undefined> {
  const paths = await uncommittedPaths(copy, untracked);
  if (paths === undefined) return "could not be read by git";
  return paths.length > 0 ? `has work uncommitted (${await uncommittedIn(copy, untracked)})` : undefined;
}
