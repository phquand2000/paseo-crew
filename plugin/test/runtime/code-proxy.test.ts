import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { codeIndex } from "../../server/runtime/code-index.ts";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROXY = join(PLUGIN, "mcp", "code.mjs");
const entry = (id: string) => JSON.parse(readFileSync(join(PLUGIN, "catalog", "mcp", id, "mcp.json"), "utf-8"));

type Call = { name: string; args: Record<string, unknown> };

async function fakeIde(options: { openEnabled: boolean; dumbCalls?: number; routeRequired?: boolean }) {
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
        if (options.routeRequired && !args.project_path) {
          return text(JSON.stringify({ error: "multiple_projects_open", message: "Multiple projects are open.", available_projects: [{ name: "main", path: "/already/open" }] }), true);
        }
        open.add(String(args.path));
        return text("opened");
      }
      if (name === "ide_close_project") {
        open.delete(String(args.project_path));
        return text("closed");
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
const tools = [
  { name: "search", description: "semble search", inputSchema: { type: "object", properties: { query: { type: "string" }, repo: { type: "string" } }, required: ["query", "repo"] } },
  { name: "find_related", description: "related", inputSchema: { type: "object", properties: {} } },
];
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  const result = m.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify(m.params.arguments) }] } : m.method === "tools/list" ? { tools } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
});
`,
  );
  return file;
}

function ideConfig(url: string, tools: string[]) {
  const { label, instructions, proxy } = entry("intellij-index");
  return { name: "intellij-index", label, instructions, tools, ...proxy, backend: { type: "http", url }, wait: { ...proxy.wait, seconds: 2, pollSeconds: 0.01 } };
}

/** A preset that opens the working copy itself, pinned here so the hook's own tests do not move with the shipped entry. */
const OPENING = {
  tool: "ide_open_project",
  args: { path: "{root}", timeoutSeconds: 300 },
  timeoutSeconds: 330,
  when: "project_not_found|No open project matches",
  route: { when: "multiple_projects_open", from: "available_projects", field: "path" },
};
const opening = (config: object) => ({ ...config, open: OPENING });

function proxy(cwd: string, config: object) {
  const child = spawn(process.execPath, [PROXY, JSON.stringify(config)], { cwd, stdio: ["pipe", "pipe", "inherit"] });
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
  const code = proxy(repo(), ideConfig(ide.url, ["ide_find_references"]));
  try {
    const started = await code.rpc("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(started.result.serverInfo.name, "intellij-index");
    assert.match(started.result.instructions, /prefer using intellij-index MCP tools for code navigation and refactoring/);
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

test("an IDE call is pinned to the working copy, a preset that opens it does so on first use, and a switched-off tool is reported", async () => {
  const ide = await fakeIde({ openEnabled: true });
  const cwd = repo();
  const code = proxy(cwd, opening(ideConfig(ide.url, ["ide_find_references", "ide_find_symbol", "ide_diagnostics"])));
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
  ide.open.add(cwd);
  const code = proxy(cwd, ideConfig(ide.url, ["ide_find_references"]));
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
  ide.open.add(cwd);
  const code = proxy(cwd, ideConfig(ide.url, ["ide_find_references"]));
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

test("the shipped IntelliJ entry opens the seat's own working copy when the IDE does not have it", async () => {
  const ide = await fakeIde({ openEnabled: true });
  const cwd = repo();
  const code = proxy(cwd, ideConfig(ide.url, ["ide_find_references"]));
  try {
    await code.rpc("tools/call", { name: "ide_find_references", arguments: {} });
    const opens = ide.calls.filter((call) => call.name === "ide_open_project");
    assert.equal(opens.length, 1, "the copy is opened once, on the call that found it missing");
    assert.equal(opens[0]!.args.path, cwd);
  } finally {
    code.stop();
    ide.close();
  }
});

test("when the IDE can't open the working copy the agent is told the open tool is switched off", async () => {
  const ide = await fakeIde({ openEnabled: false });
  const code = proxy(repo(), opening(ideConfig(ide.url, ["ide_find_references"])));
  try {
    const reply = await code.rpc("tools/call", { name: "ide_find_references", arguments: {} });
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /ide_open_project switched off/);
  } finally {
    code.stop();
    ide.close();
  }
});

test("an unreachable IDE fails the call with a way forward", async () => {
  const code = proxy(repo(), ideConfig("http://127.0.0.1:9/mcp", ["ide_find_references"]));
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

test("code search lists the backend's tool with the catalog's description, hides the pinned argument and runs against the working copy", async () => {
  const cwd = repo();
  const { label, instructions, proxy: spec } = entry("code-search");
  const code = proxy(cwd, { name: "code-search", label, instructions, tools: ["search"], ...spec, backend: { type: "stdio", command: [process.execPath, fakeSemble()] } });
  try {
    const listed = await code.rpc("tools/list");
    assert.deepEqual(listed.result.tools.map((tool: { name: string }) => tool.name), ["search"]);
    assert.equal(listed.result.tools[0].description, spec.descriptions.search);
    assert.deepEqual(listed.result.tools[0].inputSchema.required, ["query"]);
    assert.equal(listed.result.tools[0].inputSchema.properties.repo, undefined);
    const reply = await code.rpc("tools/call", { name: "search", arguments: { query: "retry a failed payment", repo: "/elsewhere" } });
    assert.deepEqual(JSON.parse(reply.result.content[0].text), { query: "retry a failed payment", repo: cwd });
  } finally {
    code.stop();
  }
});

test("opening a working copy while other projects are open is routed through one of them", async () => {
  const ide = await fakeIde({ openEnabled: true, routeRequired: true });
  const cwd = repo();
  const code = proxy(cwd, opening(ideConfig(ide.url, ["ide_find_references"])));
  try {
    const reply = await code.rpc("tools/call", { name: "ide_find_references", arguments: {} });
    assert.equal(reply.result.isError, false, reply.result.content[0].text);
    const opens = ide.calls.filter((call) => call.name === "ide_open_project");
    assert.deepEqual(opens.map((call) => call.args.project_path), [undefined, "/already/open"]);
    assert.equal(opens[1]!.args.path, cwd);
  } finally {
    code.stop();
    ide.close();
  }
});

test("the desk opens a copy it takes with the shipped entry, routed through an open project, and closes that copy alone", async () => {
  const ide = await fakeIde({ openEnabled: true, routeRequired: true });
  try {
    const { label, proxy: spec } = entry("intellij-index");
    const index = codeIndex({ ...spec, id: "intellij-index", label, backend: { type: "http", url: ide.url } });
    const opened = await index.open("/slots/S1");
    assert.equal(opened.ok, true, opened.text);
    assert.deepEqual(ide.calls.map((call) => [call.args.path, call.args.project_path]), [["/slots/S1", undefined], ["/slots/S1", "/already/open"]]);
    assert.ok(ide.open.has("/slots/S1"));

    const closed = await index.close("/slots/S1");
    assert.equal(closed.ok, true, closed.text);
    assert.deepEqual(ide.calls.at(-1), { name: "ide_close_project", args: { project_path: "/slots/S1" } }, "the close names the copy, never whichever project the IDE has in front");
    assert.equal(ide.open.has("/slots/S1"), false);
  } finally {
    ide.close();
  }
});

test("a server that is slow to start does not hold the tool list for the whole call budget", async () => {
  // A stdio server that never answers anything, which is what a cold start looks like while the
  // package it runs from is still being fetched. `initialize` was issued with the call budget while
  // the list asks for its own, so the list waited for both in turn: the harness gave up on the
  // server long before the answer saying it was not reachable could be written.
  const code = proxy(repo(), {
    name: "code-search",
    label: "Code search",
    tools: ["search"],
    descriptions: { search: "Search the code." },
    listSeconds: 1,
    backend: { type: "stdio", command: [process.execPath, "-e", "setInterval(() => {}, 1000)"] },
  });
  try {
    const started = Date.now();
    const listed = await code.rpc("tools/list");
    assert.ok(Date.now() - started < 10_000, "the list waited on the whole call budget");
    assert.deepEqual(listed.result.tools.map((tool: { name: string }) => tool.name), ["search"]);
    const only = listed.result.tools[0] as { description: string; inputSchema: { additionalProperties?: boolean } };
    assert.match(only.description, /Search the code\./, "the preset's own description is kept");
    assert.match(only.description, /not reachable/, "and the seat is told the server is not there, which a configured description used to hide");
    assert.equal(only.inputSchema.additionalProperties, true, "with a schema that does not refuse the arguments it would be called with");
  } finally {
    code.stop();
  }
});
