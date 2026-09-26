import { z } from "zod";
import { defineTool } from "../services.ts";
import { startReview as start } from "../tasks/review.ts";

export const startReview = defineTool({
  name: "start_review",
  input: z.strictObject({
    task: z.string().optional(),
    focus: z.string(),
    title: z.string().max(60).optional(),
    role: z.string().optional(),
  }),
  handle: (desk, caller, args) => start(desk, caller, args),
});
