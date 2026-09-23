import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tempDir } from "../tempdir.ts";

const teamServer = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "mcp", "team.mjs");

// Codex starts MCP servers with a filtered environment; its app-server, the server's parent, carries the agent id.
test("a desk call names its agent even when the server was started without the agent's environment", async () => {
  const spool = tempDir("crew-spool-");
  const parent = spawn(
    process.execPath,
    ["-e", `require("node:child_process").spawn(process.execPath, ${JSON.stringify([teamServer, "lead", "lead", spool])}, { env: { PATH: process.env.PATH }, stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0))`],
    { env: { PATH: process.env.PATH, PASEO_AGENT_ID: "agent-7" }, stdio: ["pipe", "ignore", "inherit"], detached: true },
  );
  try {
    parent.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "status", arguments: {} } })}\n`);
    const requests = join(spool, "requests");
    const deadline = Date.now() + 5000;
    let file: string | undefined;
    while (!file && Date.now() < deadline) {
      file = existsSync(requests) ? readdirSync(requests).find((name) => name.endsWith(".json")) : undefined;
      if (!file) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(file, "the call reached the spool");
    assert.equal(JSON.parse(readFileSync(join(requests, file!), "utf-8")).agent, "agent-7");
  } finally {
    // The server waits minutes for a reply, so its whole group goes, not only the parent.
    process.kill(-parent.pid!, "SIGKILL");
  }
});
