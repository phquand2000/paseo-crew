import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const config = JSON.parse(process.argv[2] ?? "{}");
const serverName = config.name ?? "intellij-index";
const allowed = new Set(config.tools ?? []);
const ideUrl = config.ide ?? "";
const sembleCommand = config.semble ?? [];
const OPEN_SECONDS = Number(process.env.SEATWORKS_IDE_OPEN_SECONDS ?? 300);
const INDEX_WAIT_MS = Number(process.env.SEATWORKS_IDE_INDEX_WAIT_MS ?? 180000);
const INDEX_POLL_MS = Number(process.env.SEATWORKS_IDE_INDEX_POLL_MS ?? 5000);
const MAX_SYNC_PATHS = 100;

const RULE = "IMPORTANT: When applicable, prefer using intellij-index MCP tools for code navigation and refactoring.";
const INSTRUCTIONS = {
  "intellij-index": `${RULE} Every call answers for your own working copy, and paths are relative to it.`,
  "code-search": "Search your own working copy only for code you can describe but not name. For names, text, references, hierarchies and refactoring, use the intellij-index tools.",
};

const SEMBLE_TOOLS = [
  {
    name: "search",
    description:
      "Find code in this working copy by what it does when you don't know its name. Describe the behavior in one focused query, not an error message. Returns file paths, line numbers and snippets. When you know a name, use ide_find_symbol or ide_search_text instead.",
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
];

function gitOut(args, cwd = process.cwd()) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

const root = gitOut(["rev-parse", "--show-toplevel"])?.trim() || process.cwd();
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const text = (value, isError = false) => ({ content: [{ type: "text", text: value }], isError });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function excludeIdeFiles() {
  try {
    const common = gitOut(["rev-parse", "--path-format=absolute", "--git-common-dir"], root)?.trim();
    if (!common) return;
    const file = join(common, "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf-8") : "";
    if (current.split(/\r?\n/).includes(".idea/")) return;
    mkdirSync(join(common, "info"), { recursive: true });
    appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}.idea/\n`);
  } catch {}
}

let rpcId = 0;
async function ide(name, args, timeoutMs = 120000) {
  const listing = name === "tools/list";
  const response = await fetch(ideUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: listing ? "tools/list" : "tools/call", params: listing ? {} : { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  const parsed = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
  if (parsed.error) throw new Error(parsed.error.message ?? "IDE error");
  return parsed.result;
}

const firstText = (result) => (result?.content ?? []).map((part) => part.text ?? "").join("\n");

function withoutKey(schema, key) {
  const properties = { ...(schema?.properties ?? {}) };
  delete properties[key];
  const required = (schema?.required ?? []).filter((name) => name !== key);
  const next = { ...schema, type: "object", properties };
  if (required.length > 0) next.required = required;
  else delete next.required;
  return next;
}

async function ideTools() {
  const wanted = [...allowed].filter((name) => name.startsWith("ide_"));
  if (wanted.length === 0 || !ideUrl) return [];
  try {
    const listed = await ide("tools/list", {}, 3000);
    const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
    return wanted.map((name) => {
      const tool = byName.get(name);
      if (!tool) return { name, description: "Switched off in the IDE right now; calls fail until it is switched on.", inputSchema: { type: "object", properties: {} } };
      return { name, description: tool.description, inputSchema: withoutKey(tool.inputSchema, "project_path") };
    });
  } catch {
    return wanted.map((name) => ({ name, description: "IDE code intelligence for this working copy. The IDE was not reachable when this session started; calls fail until it runs.", inputSchema: { type: "object", properties: {}, additionalProperties: true } }));
  }
}

const notOpen = (result) => result?.isError && /project_not_found|No open project matches/.test(firstText(result));
const indexing = (result) => result?.isError && /dumb mode|index is not ready/i.test(firstText(result));
const brokenPlugin = (result) => result?.isError && /CannotStartProcessException|ProcessNotCreatedException|lsp4ij/.test(firstText(result));
const switchedOff = (result) => result?.isError && /^Tool \S+ not found/.test(firstText(result));

async function openHere() {
  excludeIdeFiles();
  const opened = await ide("ide_open_project", { path: root, timeoutSeconds: OPEN_SECONDS }, (OPEN_SECONDS + 30) * 1000);
  if (!opened?.isError) return "";
  const why = firstText(opened);
  return /not found/i.test(why) ? "the IDE can't open projects by path (ide_open_project is switched off in the IDE)" : why;
}

async function waitForIndex() {
  const until = Date.now() + INDEX_WAIT_MS;
  while (Date.now() < until) {
    await sleep(INDEX_POLL_MS);
    const status = await ide("ide_index_status", { project_path: root }).catch(() => undefined);
    if (status && !status.isError && !/"isDumbMode"\s*:\s*true/.test(firstText(status))) return true;
  }
  return false;
}

function statusPaths(porcelain) {
  const paths = new Set();
  const entries = porcelain.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.length < 4) continue;
    paths.add(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2)) && entries[i + 1]) paths.add(entries[++i]);
  }
  return paths;
}

let seenHead;
let seenStatus;
async function syncChanges() {
  const head = gitOut(["rev-parse", "HEAD"], root)?.trim() ?? "";
  const status = gitOut(["status", "--porcelain", "-z", "--untracked-files=all"], root) ?? "";
  const firstCall = seenHead === undefined;
  if (!firstCall && head === seenHead && status === seenStatus) return;
  const changed = new Set([...statusPaths(status), ...(firstCall ? [] : statusPaths(seenStatus))]);
  const whole = (!firstCall && head !== seenHead) || changed.size > MAX_SYNC_PATHS;
  seenHead = head;
  seenStatus = status;
  if (!whole && changed.size === 0) return;
  const args = whole ? { project_path: root } : { project_path: root, paths: [...changed] };
  const result = await ide("ide_sync_files", args).catch(() => undefined);
  if (!whole && result?.isError) await ide("ide_sync_files", { project_path: root }).catch(() => undefined);
}

async function callIde(name, args) {
  if (!ideUrl) return text("No IDE is configured for this team; use search and the shell.", true);
  const request = { ...(args ?? {}), project_path: root };
  try {
    await syncChanges();
    let result = await ide(name, request);
    if (notOpen(result)) {
      const problem = await openHere();
      if (problem) return text(`The IDE has not opened this working copy (${root}) and ${problem}. Use search and the shell instead.`, true);
      result = await ide(name, request);
    }
    if (indexing(result)) {
      if (!(await waitForIndex())) return text("The IDE is still indexing this working copy. Use search and the shell meanwhile, and try again in a few minutes.", true);
      result = await ide(name, request);
    }
    if (brokenPlugin(result)) return text(`The IDE could not run ${name} because a language server plugin inside the IDE failed to start. Use the other intellij-index tools, and the build or tests for errors.`, true);
    if (switchedOff(result)) return text(`The IDE has ${name} switched off. Use the other code tools or the shell instead.`, true);
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
        serverInfo: { name: serverName, version: "2.0.0" },
        instructions: INSTRUCTIONS[serverName] ?? "",
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
