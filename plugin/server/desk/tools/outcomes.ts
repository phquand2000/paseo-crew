import { z } from "zod";
import { defineTool } from "../services.ts";
import { readOutcomes } from "../views/outcomes.ts";

export const outcomes = defineTool({
  name: "outcomes",
  input: z.strictObject({ since: z.string().optional() }),
  handle: async (_desk, caller, args) => readOutcomes(caller, args),
});
