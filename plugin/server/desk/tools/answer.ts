import { z } from "zod";
import { answerAsk } from "../asks/asks.ts";
import { str } from "../context.ts";
import { defineTool } from "../services.ts";

export const answer = defineTool({
  name: "answer",
  input: z.strictObject({ ask: z.string(), text: z.string() }),
  handle: (desk, caller, args) => answerAsk(desk, caller, { ask: str(args.ask), text: str(args.text) }),
});
