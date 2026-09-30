import { z } from "zod";

/** The lines of a lane its opener names the Human's, each with their word for it. */
export const humanLines = z
  .array(z.strictObject({ line: z.string(), question: z.string().optional(), quote: z.string().optional() }))
  .optional();
