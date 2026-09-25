import assert from "node:assert/strict";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tempDir } from "../tempdir.ts";

const teamServer = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "mcp", "team.mjs");

// Codex starts MCP servers with a filtered environment; its app-server, the server's parent, carries the agent id.
test("a desk call names its agent even when the server was started without the agent's environment", async () => {
  const spool = tempDir("sw2-spool-");
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

test("a seat is shown the choices the desk named for its tools as enums, wherever the field sits", async () => {
  const choices = { add_tasks: { role: ["peer"], skills: ["test-first", "diagnosing-bugs"] }, note: { kind: ["plans", "council"] } };
  const server = spawn(process.execPath, [teamServer, "lead", "lead", tempDir("sw2-spool-"), JSON.stringify(choices)], { stdio: ["pipe", "pipe", "inherit"] });
  try {
    const listed = new Promise<{ name: string; inputSchema: any }[]>((resolve) => {
      server.stdout.on("data", (chunk: Buffer) => {
        const reply = JSON.parse(chunk.toString().split("\n")[0]!);
        if (reply.id === 1) resolve(reply.result.tools);
      });
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    const tools = await listed;
    const task = tools.find((tool) => tool.name === "add_tasks")!.inputSchema.properties.tasks.items.properties;
    assert.deepEqual(task.role.enum, ["peer"]);
    assert.deepEqual(task.skills.items.enum, ["test-first", "diagnosing-bugs"], "a list takes the set for its items");
    assert.deepEqual(tools.find((tool) => tool.name === "note")!.inputSchema.properties.kind.enum, ["plans", "council"]);
    assert.equal(tools.find((tool) => tool.name === "start_review")!.inputSchema.properties.role.enum, undefined, "a field the desk named nothing for is left open");
  } finally {
    server.kill();
  }
});

/** The server's result for one JSON-RPC request. */
function request(server: ChildProcessByStdio<Writable, Readable, null>, id: number, method: string, params: object = {}): Promise<any> {
  const answered = new Promise((resolve) => {
    createInterface({ input: server.stdout }).on("line", (line) => {
      const reply = JSON.parse(line);
      if (reply.id === id) resolve(reply.result);
    });
  });
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return answered;
}

test("a seat's harness is told what the team server is for, and each tool's title and what it changes, as the kit writes them", async () => {
  const data = (file: string) => JSON.parse(readFileSync(join(dirname(teamServer), file), "utf-8")).reviewer;
  const server = spawn(process.execPath, [teamServer, "reviewer", "reviewer", tempDir("sw2-spool-")], { stdio: ["pipe", "pipe", "inherit"] });
  try {
    const hello = await request(server, 1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0" } });
    assert.equal(hello.instructions, data("instructions.json"));
    const { tools } = await request(server, 2, "tools/list");
    const shown = (list: { name: string; title: string; annotations: object }[]) => list.map(({ name, title, annotations }) => ({ name, title, annotations }));
    assert.deepEqual(shown(tools), shown(data("tools.json")));
  } finally {
    server.kill();
  }
});
