import { z } from "zod";
import { Json, text } from "./fields.ts";

/** A model the watch may ask over HTTP; `key` names the secret it takes, which the machine settings keep. */
export const SensorFile = z.strictObject({
  id: text,
  label: text,
  key: text,
  url: z.url({ protocol: /^https$/, error: "is not an https address" }),
  model: text,
  terms: text,
  body: Json.optional(),
  timeoutSeconds: z.number().min(1).max(30),
  retries: z.number().int().min(0).max(3),
});

/** A field the code fills is null in `instructions` until the moment it is asked at fills it; `question` is the question itself. */
const Instructions = z.union([
  text,
  z
    .record(z.string(), text.nullable())
    .refine((fields) => typeof fields.question === "string", { error: "names no question" }),
]);

const Mode = z.enum(["off", "shadow"]);
const unit = z.number().min(0).max(1);

/**
 * One condition, answered yes or no: at or above `yes` it holds, at or below `no` it does not, and between is unclear. A question
 * about an act names in `acts` each fact that opens it and the act as it asks it, the fact's own words where `{quote}` is.
 */
const Noul = z
  .strictObject({
    type: z.literal("noul"),
    instructions: Instructions,
    criteria: z.strictObject({ true: text, false: text }),
    acts: z.record(z.string(), text.includes("{quote}")).optional(),
    mode: Mode,
    yes: unit,
    no: unit,
  })
  .refine((check) => check.no < check.yes, { error: "no must sit below yes" });

/** One of several answers, taken at `sure` or more and unclear below; `after` names who an instruction must come from for it to be asked. */
const Choice = z
  .strictObject({
    type: z.literal("choice"),
    instructions: Instructions,
    criteria: z.record(z.string(), text),
    mode: Mode,
    sure: unit,
    after: z.array(text).optional(),
  })
  .refine((check) => Object.keys(check.criteria).length >= 2, { error: "a choice needs two criteria or more" });

/** `catalog/checks.json`: the questions the watch asks a sensor, by name. */
export const ChecksFile = z.record(
  z.string().regex(/^[a-z][a-z_]*$/, { error: "is not a lowercase name" }),
  z.discriminatedUnion("type", [Noul, Choice]),
);
