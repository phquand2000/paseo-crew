import { hash, no, ok, str } from "../context.ts";
import { letters } from "../letters.ts";
import type { Tool } from "../services.ts";

const LABELS = ["unheard-wait", "wrong-premise", "destructive", "drift", "struggle", "normal"];

export const raise: Tool = async ({ ctx }, paseo, caller, args) => {
  const label = str(args.label);
  const where = str(args.where);
  const quote = str(args.quote);
  if (!LABELS.includes(label)) return no(`raise needs a label, one of: ${LABELS.join(", ")}.`);
  if (!where || !quote) return no("raise needs where the ending happened and the quote from it that shows why.");
  const { project } = caller;
  ctx.event(project, { kind: "watch", agent: caller.id, label, where, quote });
  if (label === "normal") return ok("Recorded. A normal ending needs nobody's attention, so nothing was sent.");
  const to = await ctx.supervisorFor(paseo, project);
  if (!to) return no("Nobody above you is running to receive it; the ending is recorded either way.");
  await ctx.post(paseo, to, `attention:${caller.id}:${hash(label, quote)}`, letters.attention(label, where, quote));
  return ok(`Raised ${label} to the owner. Keep reading endings; nothing to wait for.`);
};
