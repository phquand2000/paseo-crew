import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { tempDir } from "../tempdir.ts";

export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PROXY = join(PLUGIN, "mcp", "code.mjs");
export const entry = (id: string) => JSON.parse(readFileSync(join(PLUGIN, "catalog", "mcp", id, "mcp.json"), "utf-8"));

export type Call = { name: string; args: Record<string, unknown> };

export type IdeOptions = {
  openEnabled: boolean;
  dumbCalls?: number;
  routeRequired?: boolean;
  session?: boolean;
  streamed?: boolean;
  slowMs?: number;
  syncMs?: number;
  port?: number;
};

/**
 * An IDE's MCP server over HTTP, plain JSON by default: the least a Streamable HTTP server may be. `session` asks for its
 * session id on every request after the handshake, and `streamed` answers a call as a stream, a progress note first and the answer after.
 */
export async function fakeIde(options: IdeOptions) {
  const calls: Call[] = [];
  const notified: string[] = [];
  const order: string[] = [];
  const open = new Set<string>();
  let dumb = options.dumbCalls ?? 0;
  const server = createServer((request, response) => {
    if (request.method !== "POST") return void response.writeHead(405).end();
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const message = JSON.parse(body);
      if (options.session && message.method !== "initialize" && request.headers["mcp-session-id"] !== "s1")
        return void response.writeHead(400).end("no session");
      if (message.id === undefined) {
        notified.push(message.method);
        return void response.writeHead(202).end();
      }
      const reply = (result: unknown) => {
        const answer = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
        const headers = { ...(options.session ? { "Mcp-Session-Id": "s1" } : {}) };
        if (!options.streamed || message.method !== "tools/call")
          return void response.writeHead(200, { "Content-Type": "application/json", ...headers }).end(answer);
        const token = message.params?._meta?.progressToken;
        const note =
          token === undefined
            ? ""
            : `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: 1, message: "indexing" } })}\n\n`;
        // The note while the work goes on, the answer a moment later, as a call that takes a while streams them.
        response.writeHead(200, { "Content-Type": "text/event-stream", ...headers }).write(note);
        setTimeout(() => response.end(`event: message\ndata: ${answer}\n\n`), 200);
      };
      if (message.method === "initialize")
        return reply({
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fake-ide", version: "0" },
        });
      if (message.method === "tools/list") {
        const refs = {
          name: "ide_find_references",
          title: "Find references",
          annotations: { readOnlyHint: true, openWorldHint: false },
          description: "refs",
        };
        reply({
          tools: [
            {
              ...refs,
              inputSchema: {
                type: "object",
                properties: { project_path: { type: "string" }, file: { type: "string" } },
                required: ["project_path"],
              },
            },
          ],
        });
        return;
      }
      if (options.slowMs) return void setTimeout(() => answerCall(message, reply), options.slowMs);
      answerCall(message, reply);
    });
  });
  const answerCall = (
    message: { params: { name: string; arguments: Record<string, unknown> } },
    reply: (result: unknown) => void,
  ) => {
    const { name, arguments: args } = message.params;
    calls.push({ name, args });
    order.push(name);
    const text = (value: string, isError = false) => reply({ content: [{ type: "text", text: value }], isError });
    if (name === "ide_open_project") {
      if (!options.openEnabled) return text(`Tool ${name} not found`, true);
      if (options.routeRequired && !args.project_path) {
        return text(
          JSON.stringify({
            error: "multiple_projects_open",
            message: "Multiple projects are open.",
            available_projects: [{ name: "main", path: "/already/open" }],
          }),
          true,
        );
      }
      open.add(String(args.path));
      return text("opened");
    }
    if (name === "ide_close_project") {
      open.delete(String(args.project_path));
      return text("closed");
    }
    if (name === "ide_sync_files")
      return void setTimeout(() => (order.push("synced"), text("synced")), options.syncMs ?? 0);
    if (name === "ide_index_status") return text(JSON.stringify({ isDumbMode: dumb > 0 }));
    if (name === "ide_find_symbol") return text(`Tool ${name} not found`, true);
    if (name === "ide_diagnostics")
      return text(
        "java.util.concurrent.ExecutionException: com.redhat.devtools.lsp4ij.server.CannotStartProcessException: harper-ls",
        true,
      );
    if (!open.has(String(args.project_path)))
      return text('{"error":"project_not_found","message":"No open project matches"}', true);
    if (dumb > 0) {
      dumb--;
      return text("IDE index is not ready (dumb mode) — IntelliJ is indexing in the background.", true);
    }
    text(`references in ${args.project_path}`);
  };
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/mcp`, port, calls, notified, order, open, close: () => server.close() };
}

export function repo(): string {
  const dir = tempDir("sw2-code-");
  execFileSync("git", ["init", "-q", dir]);
  return realpathSync(dir);
}

/** A code search server over stdio that writes its pid beside itself; `listMs` holds its first tool list back that long after a quick handshake. */
export function fakeSemble(listMs = 0): string {
  const file = join(tempDir("sw2-semble-"), "semble.mjs");
  writeFileSync(
    file,
    `import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(process.argv[1] + ".pid", String(process.pid));
const tools = [
  { name: "search", description: "semble search", inputSchema: { type: "object", properties: { query: { type: "string" }, repo: { type: "string" } }, required: ["query", "repo"] } },
  { name: "find_related", description: "related", inputSchema: { type: "object", properties: {} } },
];
let first = true;
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  const hello = { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-semble", version: "0" } };
  const result = m.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify(m.params.arguments) }] } : m.method === "tools/list" ? { tools } : m.method === "initialize" ? hello : {};
  const answer = () => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
  if (m.method === "tools/list" && first) setTimeout(answer, ${listMs});
  else answer();
  if (m.method === "tools/list") first = false;
});
`,
  );
  return file;
}

export function ideConfig(url: string, tools: string[]) {
  const { label, instructions, proxy } = entry("intellij-index");
  return {
    name: "intellij-index",
    label,
    instructions,
    tools,
    ...proxy,
    backend: { type: "http", url },
    wait: { ...proxy.wait, seconds: 2, pollSeconds: 0.01 },
  };
}

const OPENING = {
  tool: "ide_open_project",
  args: { path: "{root}", timeoutSeconds: 300 },
  timeoutSeconds: 330,
  when: "project_not_found|No open project matches",
  route: { when: "multiple_projects_open", from: "available_projects", field: "path" },
};
export const opening = (config: object) => ({ ...config, open: OPENING });

/** A harness with the proxy for `config` started in `cwd`, as an SDK client over its stdio. */
export async function proxy(cwd: string, config: object, changed?: () => void, env: Record<string, string> = {}) {
  const client = new Client(
    { name: "probe", version: "0" },
    changed ? { listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: changed } } } : {},
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [PROXY, JSON.stringify(config)],
    cwd,
    env: { PATH: process.env.PATH ?? "", ...env },
    stderr: "inherit",
  });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { client, call, pid: transport.pid!, stop: () => client.close() };
}

export const work = (calls: Call[]) =>
  calls.filter((call) => !["ide_sync_files", "ide_index_status"].includes(call.name)).map((call) => call.name);

/** Whether no process has this id any more. */
export function gone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

export const within = async (ms: number, check: () => boolean) => {
  for (const end = Date.now() + ms; !check(); await new Promise((resolve) => setTimeout(resolve, 20)))
    if (Date.now() > end) return false;
  return true;
};
