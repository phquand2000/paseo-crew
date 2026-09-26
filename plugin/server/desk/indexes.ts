import { errorText } from "../core/errors.ts";
import { excludeFromGit } from "../core/git.ts";
import { clip } from "../core/text.ts";
import type { DeskContext } from "./context.ts";
import type { Slot } from "./ledger.ts";
import type { Project } from "./project.ts";

type Copy = Pick<Slot, "id" | "path">;

/** Opens a working copy in each code index the project has; a copy used before is brought up to date rather than opened afresh. */
export function openIndexes(ctx: DeskContext, project: Project, copy: Copy, reused: boolean): void {
  for (const index of ctx.indexes(project)) {
    for (const pattern of index.gitExclude) excludeFromGit(project.root, pattern);
    const work = index.open(copy.path).then((opened) => (opened.ok && reused ? index.sync(copy.path) : opened));
    void work.then((result) => ctx.event(project, { kind: "index.opened", server: index.id, slot: copy.id, reused, ok: result.ok, detail: clip(result.text, 200) }));
  }
}

/** Each copy `openIndexes` opened got a window of its own in the IDE, and nothing closed one. */
export function closeIndexes(ctx: DeskContext, project: Project, copy: Copy): void {
  for (const index of ctx.indexes(project)) {
    void index.close(copy.path).then(
      (result) => ctx.event(project, { kind: "index.closed", server: index.id, slot: copy.id, ok: result.ok, detail: clip(result.text, 200) }),
      (error) => ctx.event(project, { kind: "index.closed", server: index.id, slot: copy.id, ok: false, detail: clip(errorText(error), 200) }),
    );
  }
}
