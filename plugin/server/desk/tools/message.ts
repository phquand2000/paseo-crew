import { z } from "zod";
import { str } from "../context.ts";
import { sendMessage } from "../messaging/message.ts";
import { defineTool } from "../services.ts";

export const message = defineTool({
  name: "message",
  input: z.strictObject({ to: z.string(), text: z.string() }),
  handle: (desk, caller, args) => sendMessage(desk, caller, { to: str(args.to), text: str(args.text) }),
});
