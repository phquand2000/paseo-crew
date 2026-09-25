import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";
import { ANSWER_WITHIN_MS } from "../../server/desk/desk.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a seat waits for a desk call longer than the desk takes to answer it, so no answer is lost on its way back", () => {
  const kit = loadKit(pluginRoot);
  assert.ok(Number(kit.harnesses.omp!.provider.env?.OMP_MCP_TIMEOUT_MS) > ANSWER_WITHIN_MS, "omp gives up on a call after 30 s unless told otherwise");
  assert.ok(Number((kit.harnesses.pi!.mcp.desk as { requestTimeoutMs?: number } | undefined)?.requestTimeoutMs) > ANSWER_WITHIN_MS, "Pi's adapter gives up after the SDK's 60 s unless told otherwise");
});
