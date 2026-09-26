import { z } from "zod";
import { reportLane } from "../lanes/report.ts";
import { defineTool } from "../services.ts";

export const report = defineTool({
  name: "report",
  input: z.strictObject({ summary: z.string(), ready: z.boolean(), carried: z.array(z.string()).optional() }),
  handle: (desk, caller, args) => reportLane(desk, caller, args),
});
