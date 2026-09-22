// Paseo lists an ACP agent's models and modes by starting it hookless, on the owner's own settings,
// so only the two listing calls are answered; anything else, a prompt above all, is refused.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const [refusal, bin, ...args] = process.argv.slice(2);
const LISTING = new Set(["initialize", "session/new"]);
const waiting = new Map();
let agent;
let seq = 0;

const reply = (message) => process.stdout.write(`${JSON.stringify({ ...message, jsonrpc: "2.0" })}\n`);

function start() {
  agent = spawn(bin, args, { stdio: ["pipe", "pipe", "ignore"] });
  agent.on("error", (error) => settleAll(error.message));
  agent.on("exit", (code) => settleAll(`${bin} exited with ${code}`));
  createInterface({ input: agent.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    // What the agent says of itself as it opens a session, its commands among it, Paseo waits for.
    if ("method" in message && !("id" in message)) return reply(message);
    const done = waiting.get(message.id);
    if (!done || "method" in message) return;
    waiting.delete(message.id);
    done(message);
  });
}

function settleAll(error) {
  for (const done of waiting.values()) done({ error: { code: -32603, message: `Seat room: ${error}` } });
  waiting.clear();
}

function ask(method, params) {
  if (!agent) start();
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    agent.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

// One at a time, in the order they came, and all of them answered before this exits.
let queue = Promise.resolve();

async function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!("id" in message) || !("method" in message)) return;
  if (!LISTING.has(message.method)) return reply({ id: message.id, error: { code: -32603, message: refusal } });
  const answer = await ask(message.method, message.params);
  reply({ id: message.id, ...("error" in answer ? { error: answer.error } : { result: answer.result }) });
}

createInterface({ input: process.stdin })
  .on("line", (line) => {
    queue = queue.then(() => handle(line));
  })
  .on("close", () => {
    queue.then(() => {
      agent?.kill();
      process.exit(0);
    });
  });
