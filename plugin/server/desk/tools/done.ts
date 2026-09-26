import { z } from "zod";
import { defineTool } from "../services.ts";
import { handBack } from "../tasks/handback.ts";

const HandBack = z.strictObject({
  outcome: z.enum(["complete", "partial", "blocked"]),
  summary: z.string(),
  checks: z.string().optional(),
  leftUndone: z.string().optional(),
  discovered: z.string().optional(),
});

const Finding = z.strictObject({
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  where: z.string(),
  failure: z.string(),
  fix: z.string(),
  confirmedBy: z.string().optional(),
});

const Verdict = z.strictObject({
  verdict: z.enum(["accept", "changes", "reopen"]),
  answer: z.string(),
  answers: z.array(z.string()).optional(),
  findings: z.array(Finding).optional(),
  read: z.array(z.string()).optional(),
  ran: z.array(z.string()).optional(),
});

export const done = defineTool({ name: "done", input: HandBack, handle: handBack });

export const doneReview = defineTool({ name: "done", input: Verdict, handle: handBack });
