import { z } from "zod";
import { defineTool } from "../services.ts";
import { reworkTask } from "../tasks/rework.ts";

export const rework = defineTool({
  name: "rework",
  input: z.strictObject({ task: z.string(), text: z.string() }),
  handle: (desk, caller, args) => reworkTask(desk, caller, args),
});
