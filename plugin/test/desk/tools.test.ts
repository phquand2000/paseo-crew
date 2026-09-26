import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit/kit.ts";
import { servedBy } from "../../server/desk/services.ts";
import { TOOLS } from "../../server/desk/tools/registry.ts";

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

const shown = Object.entries(kit.toolSets).flatMap(([set, tools]) =>
  Object.entries(tools).map(([name, schema]) => ({ set, name, schema })),
);

test("every tool a seat is shown is served by exactly one handler, and that handler takes what the seat was shown", () => {
  const served = shown.map((tool) => ({
    ...tool,
    by: TOOLS.filter((handler) => servedBy([handler], tool.name, tool.schema)),
  }));
  assert.deepEqual(
    served.filter((tool) => tool.by.length !== 1).map((tool) => `${tool.set} ${tool.name}: ${tool.by.length} handlers`),
    [],
  );
  const unused = TOOLS.filter((handler) => !served.some((tool) => tool.by[0] === handler));
  assert.deepEqual(
    unused.map((handler) => handler.name),
    [],
    "a handler no tool set shows is never called",
  );
});
