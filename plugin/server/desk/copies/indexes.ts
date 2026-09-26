import { recordEvent } from "../store/event-log.ts";
import { errorText } from "../../core/errors.ts";
import { excludeFromGit } from "../../core/git.ts";
import { clip } from "../../core/text.ts";
import type { DeskBase } from "../base.ts";
import type { Slot } from "../store/ledger.ts";
import type { Project } from "../project.ts";

type Copy = Pick<Slot, "id" | "path">;

/** Opens a working copy in each code index the project has; a copy used before is brought up to date rather than opened afresh. */
export function openIndexes(
  { indexesFor }: Pick<DeskBase, "indexesFor">,
  project: Project,
  copy: Copy,
  reused: boolean,
): void {
  for (const index of indexesFor(project)) {
    for (const pattern of index.gitExclude) excludeFromGit(project.root, pattern);
    const work = index.open(copy.path).then((opened) => (opened.ok && reused ? index.sync(copy.path) : opened));
    void work.then((result) =>
      recordEvent(project, {
        kind: "index.opened",
        server: index.id,
        slot: copy.id,
        reused,
        ok: result.ok,
        detail: clip(result.text, 200),
      }),
    );
  }
}

/** Each copy `openIndexes` opened got a window of its own in the IDE, and nothing closed one. */
export function closeIndexes({ indexesFor }: Pick<DeskBase, "indexesFor">, project: Project, copy: Copy): void {
  for (const index of indexesFor(project)) {
    void index.close(copy.path).then(
      (result) =>
        recordEvent(project, {
          kind: "index.closed",
          server: index.id,
          slot: copy.id,
          ok: result.ok,
          detail: clip(result.text, 200),
        }),
      (error) =>
        recordEvent(project, {
          kind: "index.closed",
          server: index.id,
          slot: copy.id,
          ok: false,
          detail: clip(errorText(error), 200),
        }),
    );
  }
}
