import { z } from "zod";

export const text = z.string().min(1);
export const texts = z.array(z.string());
export const Json = z.record(z.string(), z.unknown());

/** A pattern the kit hands to `new RegExp` later, inside a try that reads a failure as "not reachable", so a typo must be caught here. */
export const pattern = z.string().refine(
  (value) => {
    try {
      new RegExp(value, "i");
      return true;
    } catch {
      return false;
    }
  },
  { error: "is not a pattern this machine can read" },
);
