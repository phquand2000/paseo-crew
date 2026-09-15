import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { createInterface } from "node:readline";

const config = JSON.parse(process.argv[2] ?? "{}");
const allowed = new Set(config.tools ?? []);
const ideUrl = config.ide ?? "";
const sembleCommand = config.semble ?? [];
const WRITES = new Set(["ide_refactor_rename", "ide_move_file", "ide_refactor_safe_delete"]);
const OPEN_SECONDS = Number(process.env.SEATWORKS_IDE_OPEN_SECONDS ?? 300);

const SEMBLE_TOOLS = [
  {
    name: "search",
    description:
      "Search this working copy once with a focused query describing what the code does or its name. Write queries using function or class names or behavior descriptions, not error messages. Returns file paths, line numbers and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the code does, or its name." },
        top_k: { type: "integer", description: "How many results. Default 5." },
        max_snippet_lines: { type: "integer", description: "Lines per snippet." },
      },
      required: ["query"],
    },
  },
  {
    name: "find_related",
    description:
      "Find code similar to a known location in this working copy: other implementations of an interface, callers of a function, or tests for a class. Use after search.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "File path relative to the working copy." },
        line: { type: "integer", description: "1-based line number." },
        top_k: { type: "integer", description: "How many results. Default 5." },
        max_snippet_lines: { type: "integer", description: "Lines per snippet." },
      },
      required: ["file_path", "line"],
    },
  },
];

function workingCopy() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return process.cwd();
  }
}

const root = workingCopy();
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const text = (value, isError = false) => ({ content: [{ type: "text", text: value }], isError });

function excludeIdeFiles() {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const file = join(common, "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf-8") : "";
    if (current.split(/\r?\n/).includes(".idea/")) return;
    mkdirSync(join(common, "info"), { recursive: true });
    appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}.idea/\n`);
  } catch {}
}

let rpcId = 0;
async function ide(name, args, timeoutMs = 120000) {
  const response = await fetch(ideUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: name === "tools/list" ? "tools/list" : "tools/call", params: name === "tools/list" ? {} : { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  const data = body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1);
  const parsed = JSON.parse(data);
  if (parsed.error) throw new Error(parsed.error.message ?? "IDE error");
  return parsed.result;
}

const firstText = (result) => (result?.content ?? []).map((part) => part.text ?? "").join("\n");

function withoutKey(schema, key) {
  const properties = { ...(schema?.properties ?? {}) };
  delete properties[key];
  const required = (schema?.required ?? []).filter((name) => name !== key);
  return { ...schema, type: "object", properties, ...(required.length > 0 ? { required } : { required: undefined }) };
}

async function ideTools() {
  const wanted = [...allowed].filter((name) => name.startsWith("ide_"));
  if (wanted.length === 0 || !ideUrl) return [];
  try {
    const listed = await ide("tools/list", {}, 3000);
    const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
    return wanted.map((name) => {
      const tool = byName.get(name);
      if (!tool) return { name, description: "IDE tool not enabled in the IDE right now; it answers with an error until it is.", inputSchema: { type: "object", properties: {} } };
      return { name, description: tool.description, inputSchema: withoutKey(tool.inputSchema, "project_path") };
    });
  } catch {
    return wanted.map((name) => ({ name, description: "IDE code intelligence for this working copy. The IDE was not reachable when this session started; calls fail until it runs.", inputSchema: { type: "object", properties: {}, additionalProperties: true } }));
  }
}

function notOpen(result) {
  return result?.isError && /project_not_found|No open project matches/.test(firstText(result));
}

async function openHere() {
  excludeIdeFiles();
  const opened = await ide("ide_open_project", { path: root, timeoutSeconds: OPEN_SECONDS }, (OPEN_SECONDS + 30) * 1000);
  if (opened?.isError) {
    const why = firstText(opened);
    return /not found/i.test(why) ? "the IDE can't open projects by path (ide_open_project is switched off in the IDE)" : why;
  }
  return "";
}

async function callIde(name, args) {
  if (!ideUrl) return text("No IDE is configured for this team; use search and the shell.", true);
  const request = { ...(args ?? {}), project_path: root };
  try {
    if (WRITES.has(name)) await ide("ide_sync_files", { project_path: root }).catch(() => undefined);
    let result = await ide(name, request);
    if (notOpen(result)) {
      const problem = await openHere();
      if (problem) return text(`The IDE has not opened this working copy (${root}) and ${problem}. Use search and the shell instead.`, true);
      result = await ide(name, request);
    }
    if (result?.isError && /^Tool \S+ not found/.test(firstText(result))) {
      return text(`The IDE has ${name} switched off. Use the other code tools or the shell instead.`, true);
    }
    return result;
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "did not answer in time" : "is not reachable";
    return text(`The IDE ${reason}. Use search and the shell instead.`, true);
  }
}

let semble;
function sembleClient() {
  if (semble) return semble;
  const [command, ...args] = sembleCommand;
  if (!command) return undefined;
  const child = spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "ignore"] });
  const waiting = new Map();
  let next = 0;
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const done = waiting.get(message.id);
      if (done) {
        waiting.delete(message.id);
        done(message);
      }
    } catch {}
  });
  const failAll = () => {
    for (const done of waiting.values()) done({ error: { message: "semble stopped" } });
    waiting.clear();
    semble = undefined;
  };
  child.on("exit", failAll);
  child.on("error", failAll);
  const request = (method, params, timeoutMs = 180000) =>
    new Promise((resolve) => {
      const id = ++next;
      const timer = setTimeout(() => {
        waiting.delete(id);
        resolve({ error: { message: "semble did not answer in time" } });
      }, timeoutMs);
      waiting.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const ready = request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "seatworks-code", version: "2.0.0" } }).then((reply) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return reply;
  });
  semble = { request, ready };
  return semble;
}

async function callSemble(name, args) {
  const client = sembleClient();
  if (!client) return text("Code search is not configured for this team; use the shell.", true);
  const started = await client.ready;
  if (started.error) return text(`Code search could not start: ${started.error.message}. Use the shell.`, true);
  const request = { ...(args ?? {}), repo: root };
  if (typeof request.file_path === "string" && isAbsolute(request.file_path)) request.file_path = relative(root, request.file_path);
  const reply = await client.request("tools/call", { name, arguments: request });
  if (reply.error) return text(`Code search failed: ${reply.error.message}. Use the shell.`, true);
  return reply.result;
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "code", version: "2.0.0" },
        instructions: "Code intelligence for your own working copy. Paths are relative to it. search finds code by meaning; the ide_ tools answer definitions, references, hierarchies and diagnostics from the IDE's index.",
      },
    });
  } else if (method === "tools/list") {
    const tools = [...SEMBLE_TOOLS.filter((tool) => allowed.has(tool.name)), ...(await ideTools())];
    send({ jsonrpc: "2.0", id, result: { tools } });
  } else if (method === "tools/call") {
    const name = params?.name;
    if (!allowed.has(name)) {
      send({ jsonrpc: "2.0", id, result: text(`Unknown tool ${name}.`, true) });
      return;
    }
    const result = name.startsWith("ide_") ? await callIde(name, params?.arguments) : await callSemble(name, params?.arguments);
    send({ jsonrpc: "2.0", id, result });
  } else if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
  } else if (id !== undefined && id !== null) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
