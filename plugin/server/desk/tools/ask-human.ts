import { z } from "zod";
import { askHuman as ask } from "../human/questions.ts";
import { defineTool } from "../services.ts";

/** Puts a decision only the Human can make on their question queue, with what happens while they are silent. */
export const askHuman = defineTool({
  name: "ask_human",
  input: z.strictObject({
    question: z.string(),
    why: z.string(),
    lane: z.string().optional(),
    options: z
      .array(z.strictObject({ label: z.string().max(60), effect: z.string() }))
      .min(2)
      .max(4),
    recommend: z.string(),
    reason: z.string(),
    ifSilent: z.string(),
    class: z.enum(["reversible", "costly", "irreversible"]),
  }),
  handle: (desk, caller, args) => ask(desk, caller, args),
});
