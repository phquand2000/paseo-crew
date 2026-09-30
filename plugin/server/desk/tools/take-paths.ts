import { z } from "zod";
import { takePaths as take } from "../lanes/take-paths.ts";
import { defineTool } from "../services.ts";

/** A Lead widens its lane's write set; open lanes that may write the same are named, never a refusal. */
export const takePaths = defineTool({
  name: "take_paths",
  input: z.strictObject({ paths: z.array(z.string()).min(1), why: z.string() }),
  handle: (desk, caller, args) => take(desk, caller, args),
});
