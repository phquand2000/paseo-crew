import { recordEvent } from "../store/event-log.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { no, ok } from "../context.ts";
import { defineTool } from "../services.ts";

/** Keeps a page in a folder the caller's role writes under the project's state, never in the repository. */
export const note = defineTool({
  name: "note",
  input: z.strictObject({ kind: z.string(), name: z.string(), text: z.string() }),
  async handle(_desk, caller, args) {
    const folders = (caller.role.writes ?? [])
      .filter((entry) => entry.endsWith("/"))
      .map((entry) => entry.slice(0, -1));
    const kind = args.kind.trim().replace(/\/$/, "");
    if (!folders.includes(kind))
      return no(
        folders.length > 0
          ? `${kind} is no folder you keep pages in: ${folders.join(", ")}.`
          : "Your role keeps no pages.",
      );
    const name = args.name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name))
      return no(`${name} is not one file name: no folders in it, like cart-plan.md.`);
    const file = join(caller.project.state, kind, name);
    const replaced = existsSync(file);
    mkdirSync(join(caller.project.state, kind), { recursive: true });
    writeFileSync(file, args.text.endsWith("\n") ? args.text : `${args.text}\n`);
    recordEvent(caller.project, { kind: "note.written", file: join(kind, name), by: caller.id, replaced });
    return ok(`${replaced ? "Replaced" : "Wrote"} ${file}. Name it by that path wherever you point to it.`);
  },
});
