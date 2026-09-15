import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const config = JSON.parse(process.argv[2] ?? "{}");
const label = config.label ?? config.name ?? "The code server";
const allowed = new Set(config.tools ?? []);
const backend = config.backend ?? {};
const pin = config.pin;
const CALL_MS = (config.timeoutSeconds ?? 180) * 1000;
const LIST_MS = backend.type === "stdio" ? 20000 : 3000;

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
const replyText = (result) => (result?.content ?? []).map((part) => part.text ?? "").join("\n");
const failed = (pattern, result) => Boolean(pattern && result?.isError) && new RegExp(pattern, "i").test(replyText(result));
const pinned = (args = {}, path = root) => (pin ? { ...args, [pin]: path } : { ...args });

function withRoot(value, path) {
  if (typeof value === "string") return value.replaceAll("{root}", path);
  if (Array.isArray(value)) return value.map((item) => withRoot(item, path));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withRoot(item, path)]));
  return value;
}

function excludeFromGit() {
  const patterns = config.gitExclude ?? [];
  if (patterns.length === 0) return;
  try {
    const common = gitOut(["rev-parse", "--path-format=absolute", "--git-common-dir"], root)?.trim();
    if (!common) return;
    const file = join(common, "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf-8") : "";
    const missing = patterns.filter((pattern) => !current.split(/\r?\n/).includes(pattern));
    if (missing.length === 0) return;
    mkdirSync(join(common, "info"), { recursive: true });
    appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
  } catch {}
}

function backendError(error) {
  const problem = new Error(error?.message ?? "server error");
  if (error?.timeout) problem.name = "TimeoutError";
  return problem;
}

function httpBackend(url) {
  let id = 0;
  return async (method, params, timeoutMs) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    const parsed = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
    if (parsed.error) throw backendError(parsed.error);
    return parsed.result;
  };
}

function stdioBackend(command = []) {
  let client;
  const start = () => {
    const [bin, ...args] = command;
    const child = spawn(bin, args, { cwd: root, stdio: ["pipe", "pipe", "ignore"] });
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
    const stop = (error) => {
      for (const done of waiting.values()) done({ error });
      waiting.clear();
      client = undefined;
    };
    child.on("exit", () => stop({ message: "stopped" }));
    child.on("error", (error) => stop({ message: error.message }));
    const request = (method, params, timeoutMs) =>
      new Promise((resolve) => {
        const id = ++next;
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve({ error: { message: "no answer in time", timeout: true } });
        }, timeoutMs);
        waiting.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    const ready = request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "seatworks-code", version: "2.0.0" } }, CALL_MS).then((reply) => {
      if (!reply.error) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      return reply;
    });
    return { request, ready };
  };
  return async (method, params, timeoutMs) => {
    if (!command[0]) throw new Error("no command is set");
    client ??= start();
    const started = await client.ready;
    if (started.error) throw backendError(started.error);
    const reply = await client.request(method, params, timeoutMs);
    if (reply.error) throw backendError(reply.error);
    return reply.result;
  };
}

const rpc = backend.type === "stdio" ? stdioBackend(backend.command) : httpBackend(backend.url);
const tool = (name, args, timeoutMs = CALL_MS) => rpc("tools/call", { name, arguments: args }, timeoutMs);

function withoutKey(schema, key) {
  if (!key) return schema;
  const properties = { ...(schema?.properties ?? {}) };
  delete properties[key];
  const required = (schema?.required ?? []).filter((name) => name !== key);
  const next = { ...schema, type: "object", properties };
  if (required.length > 0) next.required = required;
  else delete next.required;
  return next;
}

async function listTools() {
  const wanted = [...allowed];
  if (wanted.length === 0) return [];
  const describe = (name, fallback) => config.descriptions?.[name] ?? fallback;
  try {
    const listed = await rpc("tools/list", {}, LIST_MS);
    const byName = new Map((listed?.tools ?? []).map((entry) => [entry.name, entry]));
    return wanted.map((name) => {
      const found = byName.get(name);
      if (!found) return { name, description: `Switched off in ${label} right now; calls fail until it is switched on.`, inputSchema: { type: "object", properties: {} } };
      return { name, description: describe(name, found.description), inputSchema: withoutKey(found.inputSchema, pin) };
    });
  } catch {
    const note = `${label} was not reachable when this session started; calls fail until it runs.`;
    return wanted.map((name) => ({ name, description: describe(name, note), inputSchema: { type: "object", properties: {}, additionalProperties: true } }));
  }
}

function explain(result, name) {
  const match = (config.errors ?? []).find((entry) => failed(entry.when, result));
  return match ? text(match.reply.replaceAll("{tool}", name), true) : undefined;
}

function routeOf(result, route) {
  const body = replyText(result);
  if (!route || !new RegExp(route.when, "i").test(body)) return undefined;
  try {
    const list = JSON.parse(body)?.[route.from];
    return Array.isArray(list) ? list.find((item) => typeof item?.[route.field] === "string")?.[route.field] : undefined;
  } catch {
    return undefined;
  }
}

async function openHere() {
  const hook = config.open;
  excludeFromGit();
  const args = withRoot(hook.args ?? pinned(), root);
  const timeoutMs = (hook.timeoutSeconds ?? 330) * 1000;
  let opened = await tool(hook.tool, args, timeoutMs);
  const route = routeOf(opened, hook.route);
  if (route) opened = await tool(hook.tool, pinned(args, route), timeoutMs);
  if (!opened?.isError) return undefined;
  return explain(opened, hook.tool) ?? text(`${label} could not open this working copy (${root}): ${replyText(opened)} Use the other tools and the shell instead.`, true);
}

async function waitReady() {
  const hook = config.wait;
  const until = Date.now() + (hook.seconds ?? 180) * 1000;
  while (Date.now() < until) {
    await sleep((hook.pollSeconds ?? 5) * 1000);
    const status = await tool(hook.tool, withRoot(hook.args ?? pinned(), root)).catch(() => undefined);
    if (status && !status.isError && !(hook.busy && new RegExp(hook.busy, "i").test(replyText(status)))) return true;
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
  const hook = config.sync;
  if (!hook) return;
  const head = gitOut(["rev-parse", "HEAD"], root)?.trim() ?? "";
  const status = gitOut(["status", "--porcelain", "-z", "--untracked-files=all"], root) ?? "";
  const firstCall = seenHead === undefined;
  if (!firstCall && head === seenHead && status === seenStatus) return;
  const changed = new Set([...statusPaths(status), ...(firstCall ? [] : statusPaths(seenStatus))]);
  const whole = (!firstCall && head !== seenHead) || changed.size > (hook.maxPaths ?? 100) || (!hook.paths && changed.size > 0);
  seenHead = head;
  seenStatus = status;
  if (!whole && changed.size === 0) return;
  const result = await tool(hook.tool, whole ? pinned() : pinned({ [hook.paths]: [...changed] })).catch(() => undefined);
  if (!whole && result?.isError) await tool(hook.tool, pinned()).catch(() => undefined);
}

async function callTool(name, args) {
  const request = pinned(args ?? {});
  try {
    await syncChanges();
    let result = await tool(name, request);
    if (config.open && failed(config.open.when, result)) {
      const problem = await openHere();
      if (problem) return problem;
      result = await tool(name, request);
    }
    if (config.wait && failed(config.wait.when, result)) {
      if (!(await waitReady())) return text(`${label} is still preparing this working copy. Use the other tools and the shell meanwhile, and try again in a few minutes.`, true);
      result = await tool(name, request);
    }
    return explain(result, name) ?? result;
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "did not answer in time" : "is not reachable";
    return text(`${label} ${reason}. Use the other tools and the shell instead.`, true);
  }
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
        serverInfo: { name: config.name ?? "code", version: "2.0.0" },
        instructions: config.instructions ?? "",
      },
    });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: await listTools() } });
  } else if (method === "tools/call") {
    const name = params?.name;
    if (!allowed.has(name)) {
      send({ jsonrpc: "2.0", id, result: text(`Unknown tool ${name}.`, true) });
      return;
    }
    send({ jsonrpc: "2.0", id, result: await callTool(name, params?.arguments) });
  } else if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
  } else if (id !== undefined && id !== null) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
