import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a seat waits for a desk call longer than team.mjs waits for the desk, so no answer is lost on its way back", () => {
  const kit = loadKit(pluginRoot);
  const deskWait = Number(/SEATWORKS_TOOL_WAIT_MS \?\? (\d+)/.exec(readFileSync(join(pluginRoot, "mcp", "team.mjs"), "utf-8"))![1]);
  assert.ok(Number(kit.harnesses.omp!.provider.env?.OMP_MCP_TIMEOUT_MS) > deskWait, "omp gives up on a call after 30 s unless told otherwise");
  assert.ok(Number((kit.harnesses.pi!.mcp.desk as { requestTimeoutMs?: number } | undefined)?.requestTimeoutMs) > deskWait, "Pi's adapter gives up after the SDK's 60 s unless told otherwise");
});
