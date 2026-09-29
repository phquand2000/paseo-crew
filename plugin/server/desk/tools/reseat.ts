import { z } from "zod";
import { defineTool } from "../services.ts";
import { reseatTask } from "../tasks/reseat.ts";

export const reseat = defineTool({
  name: "reseat",
  input: z.strictObject({ task: z.string(), why: z.string(), role: z.string().optional() }),
  handle: (desk, caller, args) => reseatTask(desk, caller, args),
});
