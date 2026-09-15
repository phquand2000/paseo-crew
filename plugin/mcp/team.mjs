import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const role = process.argv[2] ?? "";
const spool = process.argv[3] ?? "";
const waitMs = Number(process.env.SEATWORKS_TOOL_WAIT_MS ?? 300000);
const tools = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tools.json"), "utf-8"))[role] ?? [];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(name, args) {
  if (!spool) return { ok: false, text: "The team desk is not configured for this agent." };
  const id = randomUUID();
  const requests = join(spool, "requests");
  const replies = join(spool, "replies");
  mkdirSync(requests, { recursive: true });
  mkdirSync(replies, { recursive: true });
  const request = { id, agent: process.env.PASEO_AGENT_ID ?? "", role, tool: name, args: args ?? {}, cwd: process.cwd(), at: Date.now() };
  const temp = join(requests, `${id}.tmp`);
  writeFileSync(temp, JSON.stringify(request));
  renameSync(temp, join(requests, `${id}.json`));
  const reply = join(replies, `${id}.json`);
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (existsSync(reply)) {
      try {
        const value = JSON.parse(readFileSync(reply, "utf-8"));
        unlinkSync(reply);
        return value;
      } catch {
        await sleep(100);
        continue;
      }
    }
    await sleep(250);
  }
  return { ok: false, text: "The team desk did not answer in time. Call the tool again once; if it fails again, end your turn saying so." };
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
    send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "team", version: "2.0.0" } } });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools } });
  } else if (method === "tools/call") {
    const name = params?.name;
    if (!tools.some((tool) => tool.name === name)) {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Unknown tool ${name}.` }], isError: true } });
      return;
    }
    const result = await call(name, params?.arguments);
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(result?.text ?? "") }], isError: !result?.ok } });
  } else if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
  } else if (id !== undefined && id !== null) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
