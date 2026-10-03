import { z } from "zod";
import { lease as hold } from "../leases/leases.ts";
import { defineTool } from "../services.ts";

/** A seat holds something it shares with others, by a name of its choosing; the desk keeps the queue, never a gate. */
export const lease = defineTool({
  name: "lease",
  input: z.strictObject({
    resource: z.string(),
    minutes: z.number().int().min(1).max(240).optional(),
    release: z.boolean().optional(),
  }),
  handle: (desk, caller, args) => hold(desk, caller, args),
});
