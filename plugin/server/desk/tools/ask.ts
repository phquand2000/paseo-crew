import { z } from "zod";
import { askOwner as askAbove, askUp } from "../asks/asks.ts";
import { str } from "../context.ts";
import { defineTool } from "../services.ts";

export const askOwner = defineTool({
  name: "ask",
  input: z.strictObject({ kind: z.enum(["need", "blocked", "question"]), text: z.string(), default: z.string() }),
  handle: (desk, caller, args) =>
    askAbove(desk, caller, { kind: str(args.kind), text: str(args.text), default: str(args.default) }),
});

export const askLead = defineTool({
  name: "ask",
  input: z.strictObject({ question: z.string(), tried: z.string().optional(), bestGuess: z.string() }),
  handle: (desk, caller, args) =>
    askUp(desk, caller, { question: str(args.question), tried: str(args.tried), guess: str(args.bestGuess) }),
});

export const askLeadReviewing = defineTool({
  name: "ask",
  input: z.strictObject({ question: z.string(), tried: z.string().optional() }),
  handle: (desk, caller, args) => askUp(desk, caller, { question: str(args.question), tried: str(args.tried) }),
});
