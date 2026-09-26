import { z } from "zod";
import { close } from "../../domain/incident.ts";
import { no, ok, str } from "../context.ts";
import type { Incident } from "../incidents.ts";
import { clip } from "../../core/text.ts";
import { mask } from "../../core/mask.ts";
import { defineTool } from "../services.ts";
import { at, mine } from "./incidents.ts";

export const markIncident = defineTool({
  name: "mark_incident",
  input: z.strictObject({
    id: z.string(),
    verdict: z.enum(["useful", "noise", "unknown"]),
    note: z.string().optional(),
  }),
  async handle({ ctx }, caller, args) {
    const id = str(args.id);
    // One of the three: the desk holds every call to the schema before it gets here.
    const verdict = str(args.verdict) as NonNullable<Incident["label"]>;
    const note = mask(str(args.note));
    const now = Date.now();
    const allowed = mine(caller);
    if (typeof allowed === "string") return no(allowed);
    const done = ctx.incidents(caller.project, (held) => {
      const item = held.items[id];
      if (!item || !allowed(item)) return undefined;
      item.label = verdict;
      if (note) item.note = note;
      close(item, now);
      return { ...item };
    });
    if (!done) return no(`There is no incident ${id} here for you to mark. incidents lists the ones there are.`);
    ctx.event(caller.project, {
      kind: "incident.ack",
      id,
      agent: caller.id,
      verdict,
      note: note || null,
      seat: done.seat,
      finding: done.kind,
      opened: done.opened,
      last: done.last,
    });
    const later =
      done.later !== undefined
        ? ` It was seen ${done.count} times, the last at ${at(done.last)} after you were told: ${clip(done.later.replace(/\s+/g, " "), 200)}`
        : "";
    return ok(`${id} marked ${verdict} and closed.${later}`);
  },
});
