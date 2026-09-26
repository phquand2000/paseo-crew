import { z } from "zod";
import { close } from "../closing.ts";
import { defineTool } from "../services.ts";

export const dropLane = defineTool({
  name: "drop_lane",
  input: z.strictObject({ lane: z.string(), reason: z.string() }),
  handle: (desk, caller, args) => close(desk, caller.project, caller.id, { ...args, land: false }),
});
