import { z } from "zod";
import { consult as ask } from "../messaging/consult.ts";
import { defineTool } from "../services.ts";

export const consult = defineTool({
  name: "consult",
  input: z.strictObject({ question: z.string(), project: z.string().optional() }),
  handle: (desk, caller, args) => ask(desk, caller, args),
});
