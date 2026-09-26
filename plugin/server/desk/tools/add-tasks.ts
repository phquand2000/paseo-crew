import { z } from "zod";
import { defineTool } from "../services.ts";
import { addTasks as add } from "../tasks/add-tasks.ts";

const Asked = z.strictObject({
  key: z.string(),
  title: z.string().max(60),
  goal: z.string(),
  acceptance: z.array(z.string()),
  hints: z.array(z.string()).optional(),
  holds: z.array(z.string()).optional(),
  outOfScope: z.array(z.string()),
  context: z.string().optional(),
  skills: z.array(z.string()).optional(),
  parallel: z.boolean().optional(),
  after: z.array(z.string()).optional(),
  role: z.string().optional(),
});

/** Adds tasks to the Lead's lane in one go, each waiting for what it names; a layout holding one path twice is refused. */
export const addTasks = defineTool({
  name: "add_tasks",
  input: z.strictObject({ tasks: z.array(Asked) }),
  handle: (desk, caller, args) => add(desk, caller, args.tasks),
});
