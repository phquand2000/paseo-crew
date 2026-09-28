import { z } from "zod";
import { takePaths as take } from "../lanes/take-paths.ts";
import { defineTool } from "../services.ts";

/** A Lead widens its lane's write set by paths no other open lane holds; one held elsewhere stays the Supervisor's call. */
export const takePaths = defineTool({
  name: "take_paths",
  input: z.strictObject({ paths: z.array(z.string()).min(1), why: z.string() }),
  handle: (desk, caller, args) => take(desk, caller, args),
});
