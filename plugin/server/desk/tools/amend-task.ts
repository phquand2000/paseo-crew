import { z } from "zod";
import { defineTool } from "../services.ts";
import { amendTask as amend } from "../tasks/amend-task.ts";

/** Changes what a task asks while its Peer works, keeping what it asked before; the Peer is told at its next turn. */
export const amendTask = defineTool({
  name: "amend_task",
  input: z.strictObject({
    task: z.string(),
    why: z.string(),
    goal: z.string().optional(),
    acceptance: z.array(z.string()).optional(),
    outOfScope: z.array(z.string()).optional(),
    context: z.string().optional(),
    hints: z.array(z.string()).optional(),
    holds: z.array(z.string()).optional(),
  }),
  handle: (desk, caller, args) => amend(desk, caller, args),
});
