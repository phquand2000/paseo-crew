import { z } from "zod";
import { str } from "../context.ts";
import { holdLane as hold } from "../lanes/hold.ts";
import { defineTool } from "../services.ts";

/** Stops a lane where it stands: its seats are cut short, read nothing more, and nothing starts or lands until resume_lane. */
export const holdLane = defineTool({
  name: "hold_lane",
  input: z.strictObject({ lane: z.string(), reason: z.string() }),
  handle: (desk, caller, args) => hold(desk, caller, str(args.lane), str(args.reason)),
});
