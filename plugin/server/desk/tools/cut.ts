import { z } from "zod";
import { defineTool } from "../services.ts";
import { cutTask } from "../tasks/cut.ts";

export const cut = defineTool({
  name: "cut",
  input: z.strictObject({ task: z.string(), reason: z.string() }),
  handle: (desk, caller, args) => cutTask(desk, caller, args),
});
