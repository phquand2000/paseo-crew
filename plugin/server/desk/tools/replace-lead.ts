import { z } from "zod";
import { str } from "../context.ts";
import { replaceLead as replace } from "../lanes/replace-lead.ts";
import { defineTool } from "../services.ts";

/** Seats a new Lead on an open lane whose Lead is gone; a Lead Paseo already started for it is taken on instead. */
export const replaceLead = defineTool({
  name: "replace_lead",
  input: z.strictObject({ lane: z.string(), role: z.string().optional() }),
  handle: (desk, caller, args) => replace(desk, caller, { lane: str(args.lane), role: str(args.role) }),
});
