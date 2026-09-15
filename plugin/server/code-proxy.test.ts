import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "..", "mcp", "code.mjs");

type Call = { name: string; args: Record<string, unknown> };

async function fakeIde(options: { openEnabled: boolean; dumbCalls?: number }) {
  const calls: Call[] = [];
  const open = new Set<string>();
  let dumb = options.dumbCalls ?? 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const message = JSON.parse(body);
      const reply = (result: unknown) => response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      if (message.method === "tools/list") {
        reply({ tools: [{ name: "ide_find_references", description: "refs", inputSchema: { type: "object", properties: { project_path: { type: "string" }, file: { type: "string" } }, required: ["project_path"] } }] });
        return;
      }
      const { name, arguments: args } = message.params;
      calls.push({ name, args });
      const text = (value: string, isError = false) => reply({ content: [{ type: "text", text: value }], isError });
      if (name === "ide_open_project") {
        if (!options.openEnabled) return text(`Tool ${name} not found`, true);
        open.add(String(args.path));
        return text("opened");
      }
      if (name === "ide_sync_files") return text("synced");
      if (name === "ide_index_status") return text(JSON.stringify({ isDumbMode: dumb > 0 }));
      if (name === "ide_find_symbol") return text(`Tool ${name} not found`, true);
      if (name === "ide_diagnostics") return text("java.util.concurrent.ExecutionException: com.redhat.devtools.lsp4ij.server.CannotStartProcessException: harper-ls", true);
      if (!open.has(String(args.project_path))) return text('{"error":"project_not_found","message":"No open project matches"}', true);
      if (dumb > 0) {
        dumb--;
        return text("IDE index is not ready (dumb mode) — IntelliJ is indexing in the background.", true);
      }
      text(`references in ${args.project_path}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/mcp`, calls, open, close: () => server.close() };
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw2-code-"));
  execFileSync("git", ["init", "-q", dir]);
  return realpathSync(dir);
}

function fakeSemble(): string {
  const file = join(mkdtempSync(join(tmpdir(), "sw2-semble-")), "semble.mjs");
  writeFileSync(
    file,
    `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  const result = m.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify(m.params.arguments) }] } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
});
`,
  );
  return file;
}

function proxy(cwd: string, config: object) {
  const env = { ...process.env, SEATWORKS_IDE_INDEX_POLL_MS: "10", SEATWORKS_IDE_INDEX_WAIT_MS: "2000" };
  const child = spawn(process.execPath, [PROXY, JSON.stringify(config)], { cwd, env, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map<number, (value: any) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  let id = 0;
  const rpc = (method: string, params: object = {}) =>
    new Promise<any>((resolve) => {
      const n = ++id;
      waiting.set(n, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`);
    });
  return { rpc, stop: () => child.kill() };
}

const work = (calls: Call[]) => calls.filter((call) => !["ide_sync_files", "ide_index_status"].includes(call.name)).map((call) => call.name);

test("the IDE server carries the navigation rule, lists only the role's tools and hides the project argument", async () => {
  const ide = await fakeIde({ openEnabled: true });
  const code = proxy(repo(), { name: "intellij-index", ide: ide.url, semble: [], tools: ["ide_find_references"] });
  try {
    const started = await code.rpc("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(started.result.serverInfo.name, "intellij-index");
    assert.match(started.result.instructions, /IMPORTANT: When applicable, prefer using intellij-index MCP tools for code navigation and refactoring\./);
    const listed = await code.rpc("tools/list");
    assert.deepEqual(listed.result.tools.map((tool: { name: string }) => tool.name), ["ide_find_references"]);
    assert.equal(listed.result.tools[0].inputSchema.properties.project_path, undefined);
    assert.equal(listed.result.tools[0].inputSchema.required, undefined);
    const refused = await code.rpc("tools/call", { name: "ide_refactor_rename", arguments: {} });
    assert.equal(refused.result.isError, true);
  } finally {
    code.stop();
    ide.close();
  }
});

test("an IDE call is pinned to the working copy, opens it on first use, and reports a switched-off tool", async () => {
  const ide = await fakeIde({ openEnabled: true });
  const cwd = repo();
  const code = proxy(cwd, { name: "intellij-index", ide: ide.url, semble: [], tools: ["ide_find_references", "ide_find_symbol", "ide_diagnostics"] });
  try {
    const reply = await code.rpc("tools/call", { name: "ide_find_references", arguments: { file: "a.ts", project_path: "/somewhere/else" } });
    assert.equal(reply.result.isError, false);
    assert.equal(reply.result.content[0].text, `references in ${cwd}`);
    assert.deepEqual(work(ide.calls), ["ide_find_references", "ide_open_project", "ide_find_references"]);
    assert.equal(ide.calls.find((call) => call.name === "ide_open_project")!.args.path, cwd);
    assert.match(readFileSync(join(cwd, ".git", "info", "exclude"), "utf-8"), /^\.idea\/$/m);
    const off = await code.rpc("tools/call", { name: "ide_find_symbol", arguments: { query: "x" } });
    assert.equal(off.result.isError, true);
    assert.match(off.result.content[0].text, /switched off/);
    const broken = await code.rpc("tools/call", { name: "ide_diagnostics", arguments: { file: "a.ts" } });
    assert.match(broken.result.content[0].text, /language server plugin inside the IDE failed/);
  } finally {
    code.stop();
    ide.close();
  }
});

test("a call made while the IDE indexes waits for the index and is retried", async () => {
  const ide = await fakeIde({ openEnabled: true, dumbCalls: 1 });
  const cwd = repo();
  const code = proxy(cwd, { name: "intellij-index", ide: ide.url, semble: [], tools: ["ide_find_references"] });
  try {
    const reply = await code.rpc("tools/call", { name: "ide_find_references", arguments: {} });
    assert.equal(reply.result.isError, false, reply.result.content[0].text);
    assert.ok(ide.calls.some((call) => call.name === "ide_index_status"));
  } finally {
    code.stop();
    ide.close();
  }
});

test("files changed outside the IDE are synced before the next call, and nothing is synced when nothing changed", async () => {
  const ide = await fakeIde({ openEnabled: true });
  const cwd = repo();
  const code = proxy(cwd, { name: "intellij-index", ide: ide.url, semble: [], tools: ["ide_find_references"] });
  const syncs = () => ide.calls.filter((call) => call.name === "ide_sync_files");
  try {
    await code.rpc("tools/call", { name: "ide_find_references", arguments: {} });
    assert.equal(syncs().length, 0);
    writeFileSync(join(cwd, "new.ts"), "export const x = 1;\n");
    await code.rpc("tools/call", { name: "ide_find_references", arguments: {} });
    assert.deepEqual(syncs().map((call) => call.args.paths), [["new.ts"]]);
    await code.rpc("tools/call", { name: "ide_find_references", arguments: {} });
    assert.equal(syncs().length, 1);
  } finally {
    code.stop();
    ide.close();
  }
});

test("when the IDE can't open the working copy the agent is told to use search and the shell", async () => {
  const ide = await fakeIde({ openEnabled: false });
  const code = proxy(repo(), { name: "intellij-index", ide: ide.url, semble: [], tools: ["ide_find_references"] });
  try {
    const reply = await code.rpc("tools/call", { name: "ide_find_references", arguments: {} });
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /switched off in the IDE.*search and the shell/);
  } finally {
    code.stop();
    ide.close();
  }
});

test("an unreachable IDE fails the call with a way forward", async () => {
  const code = proxy(repo(), { name: "intellij-index", ide: "http://127.0.0.1:9/mcp", semble: [], tools: ["ide_find_references"] });
  try {
    const listed = await code.rpc("tools/list");
    assert.equal(listed.result.tools.length, 1);
    const reply = await code.rpc("tools/call", { name: "ide_find_references", arguments: {} });
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /not reachable/);
  } finally {
    code.stop();
  }
});

test("code search runs against the working copy with a relative path", async () => {
  const cwd = repo();
  const code = proxy(cwd, { name: "semble", ide: "", semble: [process.execPath, fakeSemble()], tools: ["search", "find_related"] });
  try {
    const listed = await code.rpc("tools/list");
    assert.deepEqual(listed.result.tools.map((tool: { name: string }) => tool.name), ["search", "find_related"]);
    const reply = await code.rpc("tools/call", { name: "find_related", arguments: { file_path: join(cwd, "src", "a.ts"), line: 3, repo: "/elsewhere" } });
    assert.deepEqual(JSON.parse(reply.result.content[0].text), { file_path: join("src", "a.ts"), line: 3, repo: cwd });
  } finally {
    code.stop();
  }
});
