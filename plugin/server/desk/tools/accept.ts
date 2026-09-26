import { z } from "zod";
import { defineTool } from "../services.ts";
import { acceptTask } from "../tasks/accept.ts";

export const accept = defineTool({
  name: "accept",
  input: z.strictObject({ task: z.string(), overGate: z.boolean().optional(), reason: z.string().optional() }),
  handle: (desk, caller, args) => acceptTask(desk, caller, args),
});
