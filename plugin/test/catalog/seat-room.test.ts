import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../tempdir.ts";

const SEAT_ROOM = new URL("../../bin/seat-room", import.meta.url).pathname;

function seat(baseProvider: string) {
  const dir = tempDir("sw2-seat-room-");
  mkdirSync(join(dir, "harness", "acme"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify({ baseProvider, configDirEnv: "ACME_HOME", modes: [{ id: "ask", label: "Ask" }, { id: "bypass", label: "Bypass" }], provider: { command: ["KIT/bin/seat-room", "acp"] } }));
  const launched = join(dir, "launched");
  const agent = join(dir, "agent");
  writeFileSync(agent, `#!/bin/sh\necho "$ACME_HOME $*" > '${launched}'\n`);
  chmodSync(agent, 0o755);
  return { launched, env: { PATH: process.env.PATH!, SEATWORKS_KIT: dir, SEATWORKS_HARNESS: "acme", SEATWORKS_AGENT_BIN: agent } };
}

function open(env: Record<string, string>, messages: object[], args = ["acp"]): Promise<{ code: number | null; replies: any[]; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(SEAT_ROOM, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdin.on("error", () => {});
    child.on("close", (code) => resolve({ code, stderr, replies: out.split("\n").filter(Boolean).map((line) => JSON.parse(line)) }));
    child.stdin.end(messages.map((message) => `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`).join(""));
  });
}

const PROBE = [
  { id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } },
  { method: "session/update", params: {} },
  { id: 2, method: "session/new", params: { cwd: "/tmp", mcpServers: [] } },
  { id: 3, method: "session/set_mode", params: { sessionId: "seat-room", modeId: "bypass" } },
  { id: "4", method: "session/prompt", params: { sessionId: "seat-room", prompt: [{ type: "text", text: "hi" }] } },
];

test("an ACP seat the plugin did not configure tells Paseo its modes and refuses everything else, without starting the agent", async () => {
  const { launched, env } = seat("acp");
  const { code, replies } = await open(env, PROBE);
  assert.equal(code, 0);
  assert.equal(existsSync(launched), false);
  assert.deepEqual(replies.slice(0, 2), [
    { jsonrpc: "2.0", id: 1, result: { protocolVersion: 1, agentCapabilities: {} } },
    { jsonrpc: "2.0", id: 2, result: { sessionId: "seat-room", modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "bypass", name: "Bypass" }] } } },
  ]);
  assert.deepEqual(replies.slice(2).map((reply) => [reply.id, reply.result]), [[3, undefined], ["4", undefined]]);
  for (const reply of replies.slice(2)) assert.match(reply.error.message, /^Seat room: ACME_HOME is unset, so this seat would run on your own settings/);
});

test("any other launch the plugin did not configure is refused outright", async () => {
  for (const [baseProvider, args] of [["claude", ["acp"]], ["acp", ["--version"]], ["acp", []]] as const) {
    const { launched, env } = seat(baseProvider);
    const { code, replies, stderr } = await open(env, PROBE, [...args]);
    assert.equal(code, 2, `${baseProvider} ${args.join(" ")}`);
    assert.equal(existsSync(launched), false);
    assert.deepEqual(replies, []);
    assert.match(stderr, /ACME_HOME is unset/);
  }
});

test("a seat the plugin configured starts the agent on its own settings", async () => {
  const { launched, env } = seat("acp");
  const { code, replies } = await open({ ...env, ACME_HOME: "/seats/acme-peer" }, PROBE);
  assert.equal(code, 0);
  assert.deepEqual(replies, []);
  assert.equal(readFileSync(launched, "utf-8"), "/seats/acme-peer acp\n");
});
