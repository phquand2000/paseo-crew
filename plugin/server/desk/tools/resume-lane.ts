import { z } from "zod";
import { str } from "../context.ts";
import { resumeLane as resume } from "../hold.ts";
import { defineTool } from "../services.ts";

/** Lifts a hold: each seat of the lane is told to carry on, with the mail held for it, and what waited may start. */
export const resumeLane = defineTool({
  name: "resume_lane",
  input: z.strictObject({ lane: z.string(), note: z.string().optional() }),
  handle: (desk, caller, args) => resume(desk, caller, args.lane, str(args.note)),
});
