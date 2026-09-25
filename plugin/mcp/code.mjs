import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, SdkErrorCode, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const config = JSON.parse(process.argv[2] ?? "{}");
const label = config.label ?? config.name ?? "The code server";
const allowed = [...new Set(config.tools ?? [])];
const backend = config.backend ?? {};
const pin = config.pin;
const CALL_MS = (config.timeoutSeconds ?? 180) * 1000;
const LIST_MS = (config.listSeconds ?? (backend.type === "stdio" ? 20 : 3)) * 1000;
// A harness that asked for progress hears that often that a call, or the opening or indexing it waits on, still runs.
const PROGRESS_MS = Number(process.env.SEATWORKS_PROGRESS_MS ?? 20_000);
const { version } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf-8"));

function gitOut(args, cwd = process.cwd()) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

const root = gitOut(["rev-parse", "--show-toplevel"])?.trim() || process.cwd();
const text = (value, isError = false) => ({ content: [{ type: "text", text: value }], isError });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const replyText = (result) => (result?.content ?? []).map((part) => part.text ?? "").join("\n");
const failed = (pattern, result) => Boolean(pattern && result?.isError) && new RegExp(pattern, "i").test(replyText(result));
const pinned = (args = {}, path = root) => (pin ? { ...args, [pin]: path } : { ...args });
// The model is shown each schema as the backend writes it; the backend checks what it is sent.
const unchecked = { getValidator: () => (input) => ({ valid: true, data: input, errorMessage: undefined }) };
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => Promise.reject(Object.assign(new Error("no answer in time"), { name: "TimeoutError" })))]);

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

/** The backend as an MCP client, over its own stdio or HTTP: connected when first needed, and again once it drops. */
class Backend {
  #client;
  #connecting;
  connected = () => {};

  connect() {
    if (this.#client) return Promise.resolve(this.#client);
    this.#connecting ??= this.#open().finally(() => (this.#connecting = undefined));
    return this.#connecting;
  }

  async #open() {
    const [command, ...args] = backend.command ?? [];
    if (backend.type === "stdio" && !command) throw new Error("no command is set");
    // Kept quiet: a harness may not read a server's stderr, and a full pipe can stall the backend.
    const transport = backend.type === "stdio" ? new StdioClientTransport({ command, args, cwd: root, stderr: "ignore" }) : new StreamableHTTPClientTransport(new URL(backend.url));
    const client = new Client({ name: "seatworks-code", version });
    client.onclose = () => {
      if (this.#client === client) this.#client = undefined;
    };
    await client.connect(transport, { timeout: CALL_MS });
    this.#client = client;
    this.connected(client);
    return client;
  }

  /** Bounded as a whole: starting the backend is the slow part, and a harness gave up before "not reachable" was said. */
  async call(name, args, timeoutMs, ctx, progress) {
    const client = await within(this.connect(), timeoutMs);
    return client.callTool({ name, arguments: args }, { timeout: timeoutMs, resetTimeoutOnProgress: true, signal: ctx?.mcpReq.signal, onprogress: progress?.forward });
  }
}

const upstream = new Backend();

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

/** What the harness is shown of an allowed tool: the backend's own, its pinned argument hidden, the catalog's description first. */
function shownOf(name, listed) {
  const own = config.descriptions?.[name];
  const found = listed?.tools?.find((tool) => tool.name === name);
  // Appended, never replaced: a preset description alone hid the note, and a seat kept calling a server that never answered.
  const noted = (note) => ({ description: `${own ?? ""}\n\n${note}`.trim(), inputSchema: fromJsonSchema({ type: "object", properties: {}, additionalProperties: true }, unchecked) });
  if (!listed) return noted(`${label} was not reachable when this session started; calls fail until it runs.`);
  if (!found) return noted(`Switched off in ${label} right now; calls fail until it is switched on.`);
  // Its output schema stays behind: shown one, Claude and Codex give the model the JSON in place of the text.
  return { title: found.title, description: own ?? found.description, annotations: found.annotations, inputSchema: fromJsonSchema(withoutKey(found.inputSchema, pin), unchecked) };
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

/** Progress for a harness that asked: ticks of its own while a call runs, and what the backend says of its work. */
function progressOf(ctx, name) {
  const token = ctx?.mcpReq._meta?.progressToken;
  if (token === undefined) return { stop: () => {} };
  let beat = 0;
  const say = (message) => void ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, progress: ++beat, message } }).catch(() => {});
  const timer = setInterval(() => say(`${label} is still working on ${name}.`), PROGRESS_MS);
  return { forward: (update) => say(update.message ?? `${label} is working on ${name}.`), stop: () => clearInterval(timer) };
}

async function openHere(ctx, progress) {
  const hook = config.open;
  excludeFromGit();
  const args = withRoot(hook.args ?? pinned(), root);
  const timeoutMs = (hook.timeoutSeconds ?? 330) * 1000;
  let opened = await upstream.call(hook.tool, args, timeoutMs, ctx, progress);
  const route = routeOf(opened, hook.route);
  if (route) opened = await upstream.call(hook.tool, pinned(args, route), timeoutMs, ctx, progress);
  if (!opened?.isError) return undefined;
  return explain(opened, hook.tool) ?? text(`${label} could not open this working copy (${root}): ${replyText(opened)} Use the other tools and the shell instead.`, true);
}

async function waitReady(ctx) {
  const hook = config.wait;
  const until = Date.now() + (hook.seconds ?? 180) * 1000;
  while (Date.now() < until && !ctx?.mcpReq.signal.aborted) {
    await sleep((hook.pollSeconds ?? 5) * 1000);
    const status = await upstream.call(hook.tool, withRoot(hook.args ?? pinned(), root), CALL_MS).catch(() => undefined);
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
  const result = await upstream.call(hook.tool, whole ? pinned() : pinned({ [hook.paths]: [...changed] }), CALL_MS).catch(() => undefined);
  if (!whole && result?.isError) await upstream.call(hook.tool, pinned(), CALL_MS).catch(() => undefined);
}

// One sync at a time: two calls at once read the same changes, and one synced what the other had already seen.
let syncing = Promise.resolve();

async function callTool(name, args, ctx) {
  const request = pinned(args ?? {});
  const progress = progressOf(ctx, name);
  try {
    await (syncing = syncing.then(syncChanges, syncChanges));
    let result = await upstream.call(name, request, CALL_MS, ctx, progress);
    if (config.open && failed(config.open.when, result)) {
      const problem = await openHere(ctx, progress);
      if (problem) return problem;
      result = await upstream.call(name, request, CALL_MS, ctx, progress);
    }
    if (config.wait && failed(config.wait.when, result)) {
      if (!(await waitReady(ctx))) return text(`${label} is still preparing this working copy. Use the other tools and the shell meanwhile, and try again in a few minutes.`, true);
      result = await upstream.call(name, request, CALL_MS, ctx, progress);
    }
    return explain(result, name) ?? result;
  } catch (error) {
    const late = error?.name === "TimeoutError" || error?.code === SdkErrorCode.RequestTimeout;
    return text(`${label} ${late ? "did not answer in time" : "is not reachable"}. Use the other tools and the shell instead.`, true);
  } finally {
    progress.stop();
  }
}

// Asked at once and kept going past the wait below: a backend slow to start still gives its tools once it answers.
const listing = upstream.connect().then((client) => client.listTools());
// Handled now, before the harness asks anything: a backend that cannot be reached must not end this server.
listing.catch(() => {});

serveStdio(async () => {
  const listed = await within(listing, LIST_MS).catch(() => undefined);
  const mcp = new McpServer({ name: config.name ?? "code", version }, { capabilities: { tools: { listChanged: true } }, instructions: config.instructions || undefined });
  const entries = new Map(allowed.map((name) => [name, mcp.registerTool(name, shownOf(name, listed), (args, ctx) => callTool(name, args, ctx))]));
  if (listed) return mcp;
  // Shown as unreachable: once the backend answers, each tool is shown as it is, and the harness is told the list changed.
  let shown = false;
  const refresh = async (client) => {
    const late = await client.listTools().catch(() => undefined);
    if (!late || shown) return;
    shown = true;
    for (const [name, entry] of entries) {
      const { inputSchema, ...rest } = shownOf(name, late);
      entry.update({ ...rest, paramsSchema: inputSchema });
    }
  };
  upstream.connected = refresh;
  // Its first answer may have come in the moment after the wait gave up.
  listing.then(() => upstream.connect()).then(refresh, () => {});
  return mcp;
});
