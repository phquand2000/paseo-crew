import { z } from "zod";
import { openLane as open } from "../lanes/open-lane.ts";
import { defineTool } from "../services.ts";

export const openLane = defineTool({
  name: "open_lane",
  input: z.strictObject({
    title: z.string().max(60),
    outcome: z.string(),
    acceptance: z.array(z.string()),
    appetite: z.string().optional(),
    deadline: z.string().optional(),
    outOfScope: z.array(z.string()),
    issue: z.string().optional(),
    isolate: z.boolean().optional(),
    base: z.string().optional(),
    onBranch: z.boolean().optional(),
    newBranch: z.string().optional(),
    writeSet: z.array(z.string()).optional(),
    contracts: z.array(z.string()).optional(),
    after: z.array(z.string()).optional(),
    detourOf: z.string().optional(),
    role: z.string().optional(),
  }),
  handle: (desk, caller, args) => open(desk, caller, args),
});
