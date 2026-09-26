import { z } from "zod";
import { defineTool } from "../services.ts";
import { listIncidents } from "../watch/incident-review.ts";

export const incidents = defineTool({
  name: "incidents",
  input: z.strictObject({ closed: z.boolean().optional() }),
  handle: async (_desk, caller, args) => listIncidents(caller, args.closed === true),
});
