import { z } from "zod";
import { close } from "../closing.ts";
import { no, str } from "../context.ts";
import { defineTool } from "../services.ts";

export const landLane = defineTool({
  name: "land_lane",
  input: z.strictObject({ lane: z.string(), overGate: z.boolean().optional(), reason: z.string().optional() }),
  async handle(desk, caller, args) {
    // A red gate is evidence the Supervisor may overrule, never silently: landing over it says why.
    if (args.overGate && !str(args.reason))
      return no("Landing over a red gate needs its reason: pass reason with overGate true, or leave overGate out.");
    return close(desk, caller.project, caller.id, { ...args, land: true });
  },
});
