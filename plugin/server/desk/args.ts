import type { ArgSchema } from "../catalog/kit.ts";

const TYPE_WORDS: Record<string, string> = { string: "text", boolean: "true or false", number: "a number", array: "a list", object: "an object" };

const typeOf = (value: unknown): string => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value);

/** Empty for a required field: a text with nothing in it, or a list with nothing in it, answers nothing. */
const blank = (value: unknown): boolean => value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.every(blank));

function fits(name: string, schema: ArgSchema, value: unknown): string | undefined {
  if (schema.type && typeOf(value) !== schema.type) return `${name} must be ${TYPE_WORDS[schema.type] ?? schema.type}`;
  if (schema.enum && !schema.enum.includes(value)) return `${name} must be one of ${schema.enum.join(", ")}`;
  if (schema.items && Array.isArray(value)) {
    const wrong = value.map((item) => fits(`each of ${name}`, schema.items!, item)).find(Boolean);
    if (wrong) return wrong;
  }
  return undefined;
}

/**
 * Why `args` do not fit the schema the seat was shown for this tool; empty when they do.
 *
 * Nothing checked them. A harness that does not validate its own tool calls sent prose where one of
 * three words belonged, a misnamed field and a list where text belonged, and the desk took the
 * hand-back anyway, writing "No summary given." into it; a report missing `ready` went through as
 * not ready, with its carried notes dropped.
 */
export function argsProblems(schema: ArgSchema, args: Record<string, unknown>): string[] {
  const properties = schema.properties ?? {};
  const problems: string[] = [];
  for (const name of schema.required ?? []) {
    const what = properties[name]?.description;
    if (blank(args[name])) problems.push(`needs ${name}${what ? ` (${what.replace(/\.$/, "")})` : ""}`);
  }
  for (const [name, value] of Object.entries(args)) {
    const field = properties[name];
    if (!field) problems.push(`has no field ${name}`);
    else if (value !== undefined && value !== null) {
      const wrong = fits(name, field, value);
      if (wrong) problems.push(wrong);
    }
  }
  return problems;
}

/** What a tool takes, as a seat reads it back: its required fields, then the rest. */
export function shapeOf(schema: ArgSchema): string {
  const required = schema.required ?? [];
  const optional = Object.keys(schema.properties ?? {}).filter((name) => !required.includes(name));
  if (required.length === 0 && optional.length === 0) return "It takes nothing.";
  return `It takes ${required.join(", ")}${required.length > 0 && optional.length > 0 ? ", and optionally " : optional.length > 0 ? "optionally " : ""}${optional.join(", ")}.`;
}
