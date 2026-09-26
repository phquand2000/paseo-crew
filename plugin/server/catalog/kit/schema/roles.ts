import { z } from "zod";
import { AttentionChoice } from "../../../../shared/settings.ts";
import { text, texts } from "./fields.ts";

const Role = z.strictObject({
  role: text,
  label: text,
  description: z.string().optional(),
  concern: z.string().optional(),
  can: texts.optional(),
  tools: text.optional(),
  follows: text.optional(),
  defaults: z.strictObject({ harness: text, model: text.optional(), thinking: text.optional() }).optional(),
  prompt: text,
  skills: text.nullable(),
  extraSkills: z.array(z.string().regex(/^[^:]+:[^:]+$/, { error: "is not written set:name" })).optional(),
  paseoTools: z
    .strictObject({ enabled: z.boolean().optional(), disabledTools: texts.optional(), allow: texts.optional() })
    .optional(),
  hidesWords: texts.optional(),
  writes: z
    .array(
      z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/?$/, {
        error: "is not one file, or one folder ending in /, under the project's state",
      }),
    )
    .optional(),
});

/** `roles.json`: the kit's roles and the attention it starts with. */
export const RolesFile = z.strictObject({
  providerPrefix: z.string().optional(),
  attention: AttentionChoice.optional(),
  roles: z.array(Role),
});

/** The tools Paseo gives every agent, as a list the plugin keeps in step with Paseo. */
export const PaseoFile = z.strictObject({ tools: z.array(text).min(1) });

/** Commands a seat's shell finds refused on its PATH, each with why: what a rule on the command line misses, such as `env gh`. */
export const RefusedFile = z
  .record(z.string(), text)
  .refine((list) => Object.keys(list).every((name) => /^[\w.+-]+$/.test(name)), {
    error: "names what is not a command's name",
  });
