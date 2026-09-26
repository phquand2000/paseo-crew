import { z } from "zod";
import { defineTool } from "../services.ts";
import { markIncident as mark } from "../watch/incident-review.ts";

export const markIncident = defineTool({
  name: "mark_incident",
  input: z.strictObject({
    id: z.string(),
    verdict: z.enum(["useful", "noise", "unknown"]),
    note: z.string().optional(),
  }),
  handle: async (desk, caller, args) => mark(desk, caller, args),
});
