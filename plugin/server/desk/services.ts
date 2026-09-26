import { z } from "zod";
import type { ArgSchema } from "../catalog/kit.ts";
import type { Agents } from "./agents.ts";
import type { DeskBase } from "./base.ts";
import type { Caller, ToolReply } from "./context.ts";
import type { MergeQueue } from "./tasks/merge-queue.ts";
import type { OwnCopy } from "./own-copy.ts";
import type { Roster } from "./roster.ts";
import type { Slots } from "./slots.ts";
import type { Teardowns } from "./teardown.ts";
import type { Watcher } from "./watcher.ts";

/** The desk's services; a function takes only those it uses. */
export type DeskServices = DeskBase & {
  roster: Roster;
  slots: Slots;
  ownCopy: OwnCopy;
  teardowns: Teardowns;
  agents: Agents;
  merges: MergeQueue;
  watcher: Watcher;
};

/** A tool as the desk serves it: `input` is what its handler reads, and it must be the schema the calling seat was shown. */
export type ToolDef = {
  name: string;
  input: z.ZodObject;
  handle(desk: DeskServices, caller: Caller, input: Record<string, unknown>): Promise<ToolReply>;
};

export function defineTool<Input extends z.ZodObject>(tool: {
  name: string;
  input: Input;
  handle(desk: DeskServices, caller: Caller, input: z.infer<Input>): Promise<ToolReply>;
}): ToolDef {
  return tool;
}

/** A schema as a shape to compare: what each field is and must hold, not how it is described to a seat. */
function structure(schema: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(schema).sort()) {
    const value = schema[key];
    if (key === "description" || key === "$schema" || key === "additionalProperties") continue;
    if (key === "properties")
      kept[key] = Object.fromEntries(
        Object.entries(value as Record<string, Record<string, unknown>>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, field]) => [name, structure(field)]),
      );
    else if (key === "items") kept[key] = structure(value as Record<string, unknown>);
    else if (key === "required") kept[key] = [...(value as string[])].sort();
    else kept[key] = value;
  }
  return kept;
}

const shapes = new WeakMap<object, string>();

function shapeOf(owner: object, schema: () => unknown): string {
  let shape = shapes.get(owner);
  if (shape === undefined) shapes.set(owner, (shape = JSON.stringify(structure(schema() as Record<string, unknown>))));
  return shape;
}

/** The tool that serves `name` as `shown` describes it: tools of one name differ by what they take, and a role's tool set picks which it is shown. */
export function servedBy(tools: ToolDef[], name: string, shown: ArgSchema): ToolDef | undefined {
  const wanted = shapeOf(shown, () => shown);
  return tools.find(
    (tool) => tool.name === name && shapeOf(tool, () => z.toJSONSchema(tool.input, { io: "input" })) === wanted,
  );
}
