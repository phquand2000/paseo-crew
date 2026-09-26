import { z } from "zod";
import { pattern, text, texts } from "./fields.ts";

const Gate = z.strictObject({
  files: z.array(text).min(1),
  script: text.optional(),
  run: text,
  lockfiles: z.record(z.string(), text).optional(),
});

/** `reviewQuestion` goes to every review of a change under `paths`, and `rehearse`, a project command, runs with the lane gate. It never holds a landing. */
export const RiskRule = z.strictObject({
  paths: z.array(text).min(1),
  invariant: text,
  reviewQuestion: text,
  rehearse: text.optional(),
});

export type RiskRule = z.infer<typeof RiskRule>;

/** `catalog/ecosystem.json`: the project gates, risk rules and file patterns the desk and the watch read calls with. */
export const EcosystemFile = z.strictObject({
  serialOnly: texts,
  riskRules: z.array(RiskRule),
  gates: z.array(Gate),
  scriptRunners: texts,
  unsetScript: text,
  files: z.strictObject({ test: pattern, docs: pattern }),
  watch: z.strictObject({
    destructive: pattern,
    testPath: pattern,
    suppressed: pattern,
    skipped: pattern,
    assertion: pattern,
    refused: pattern,
    runners: texts,
  }),
});
