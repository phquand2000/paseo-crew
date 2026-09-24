import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tempDir } from "../tempdir.ts";

const SEAT_ROOM = fileURLToPath(new URL("../../bin/seat-room", import.meta.url));

function seat(baseProvider: string) {
  const dir = tempDir("crew-seat-room-");
  mkdirSync(join(dir, "harness", "acme"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify({ baseProvider, configDirEnv: "ACME_HOME", provider: { command: ["KIT/bin/seat-room", "acp"] } }));
  const launched = join(dir, "launched");
  const agent = join(dir, "agent");
  // Configured, it records how it was started; unconfigured, it answers ACP and records each call.
  writeFileSync(
    agent,
    `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require("node:fs");
if (process.env.ACME_HOME) { writeFileSync(${JSON.stringify(launched)}, process.env.ACME_HOME + " " + process.argv.slice(2).join(" ") + "\\n"); process.exit(0); }
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  appendFileSync(${JSON.stringify(launched)}, m.method + "\\n");
  const result = m.method === "initialize" ? { protocolVersion: 1, agentCapabilities: { loadSession: true } } : { sessionId: "s1", modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] }, configOptions: [{ id: "model", category: "model", currentValue: "m1", options: [{ value: "m1", name: "M1" }] }] };
  if (m.method === "session/new") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "available_commands_update", availableCommands: [] } } }) + "\\n");
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
});
`,
  );
  chmodSync(agent, 0o755);
  return { launched, env: { PATH: process.env.PATH!, PASEO_CREW_KIT: dir, PASEO_CREW_HARNESS: "acme", PASEO_CREW_AGENT_BIN: agent } };
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

test("an ACP seat the plugin did not configure lets Paseo list the agent's own models and modes, and refuses everything else", async () => {
  const { launched, env } = seat("acp");
  const { code, replies } = await open(env, PROBE);
  assert.equal(code, 0);
  assert.deepEqual(replies.slice(0, 3), [
    { jsonrpc: "2.0", id: 1, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } },
    // What the agent says of itself as the session opens reaches Paseo too: it waits for it.
    { jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "available_commands_update", availableCommands: [] } } },
    { jsonrpc: "2.0", id: 2, result: { sessionId: "s1", modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] }, configOptions: [{ id: "model", category: "model", currentValue: "m1", options: [{ value: "m1", name: "M1" }] }] } },
  ]);
  assert.deepEqual(replies.slice(3).map((reply) => [reply.id, reply.result]), [[3, undefined], ["4", undefined]]);
  for (const reply of replies.slice(3)) assert.match(reply.error.message, /^Seat room: ACME_HOME is unset, so this seat would run on your own settings/);
  // A prompt run on the owner's own settings is what the refusal is for: it never reaches the agent.
  assert.equal(readFileSync(launched, "utf-8"), "initialize\nsession/new\n");
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

const AGY_HOME = fileURLToPath(new URL("../../bin/agy-home", import.meta.url));

function agySeat() {
  const dir = tempDir("crew-agy-home-");
  mkdirSync(join(dir, "harness", "agy"), { recursive: true });
  writeFileSync(join(dir, "harness", "agy", "harness.json"), JSON.stringify({ baseProvider: "acp", configDirEnv: "PASEO_CREW_AGY_HOME", provider: { command: ["KIT/bin/agy-home"] } }));
  const launched = join(dir, "launched");
  const agent = join(dir, "agent");
  writeFileSync(agent, `#!/usr/bin/env bash\necho "$HOME $*" >> ${JSON.stringify(launched)}\n`);
  chmodSync(agent, 0o755);
  return { launched, env: { PATH: process.env.PATH!, HOME: "/owner", PASEO_CREW_KIT: dir, PASEO_CREW_HARNESS: "agy", PASEO_CREW_AGENT_BIN: agent } };
}

function run(env: Record<string, string>, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(AGY_HOME, args, { env, stdio: ["pipe", "ignore", "ignore"] });
    child.stdin.on("error", () => {});
    child.on("close", resolve);
    child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", ...PROBE[0] })}\n`);
  });
}

test("an agy seat runs with the seat as its home, since agy reads every setting from there", async () => {
  const { launched, env } = agySeat();
  assert.equal(await run({ ...env, PASEO_CREW_AGY_HOME: "/seats/agy-peer" }, []), 0);
  assert.equal(readFileSync(launched, "utf-8"), "/seats/agy-peer \n");
});

test("an agy launch the plugin did not configure keeps the owner's home and goes only as far as the catalog", async () => {
  const { launched, env } = agySeat();
  await run(env, []);
  assert.equal(readFileSync(launched, "utf-8"), "/owner \n");
  const refused = agySeat();
  assert.equal(await run(refused.env, ["--version"]), 2);
  assert.equal(existsSync(refused.launched), false);
});

const CLAUDE_SEAT = fileURLToPath(new URL("../../bin/claude-seat", import.meta.url));

function claudeSeat() {
  const dir = tempDir("crew-claude-seat-");
  mkdirSync(join(dir, "harness", "claude"), { recursive: true });
  writeFileSync(join(dir, "harness", "claude", "harness.json"), JSON.stringify({ baseProvider: "claude", configDirEnv: "PASEO_CREW_CLAUDE_SEAT", provider: { command: ["KIT/bin/claude-seat"], forceFlags: { "--setting-sources": "" } } }));
  const seatPath = join(dir, "seat");
  mkdirSync(seatPath);
  writeFileSync(join(seatPath, "settings.json"), JSON.stringify({ language: "vietnamese", permissions: { deny: ["WebFetch"] }, sandbox: { enabled: true } }));
  const launched = join(dir, "launched");
  const agent = join(dir, "agent");
  writeFileSync(agent, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(launched)}, JSON.stringify({ config: process.env.CLAUDE_CONFIG_DIR ?? null, argv: process.argv.slice(2) }));\n`);
  chmodSync(agent, 0o755);
  return { seatPath, launched, env: { PATH: process.env.PATH!, PASEO_CREW_KIT: dir, PASEO_CREW_HARNESS: "claude", PASEO_CREW_AGENT_BIN: agent } };
}

function launch(env: Record<string, string>, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_SEAT, args, { env, stdio: ["ignore", "ignore", "ignore"] });
    child.on("close", resolve);
  });
}

test("a Claude seat runs on the owner's login, with its role merged into the one --settings Paseo passes", async () => {
  const { seatPath, launched, env } = claudeSeat();
  const paseo = JSON.stringify({ fastMode: false, sandbox: { filesystem: { allowWrite: ["/state/x"] } } });
  assert.equal(await launch({ ...env, PASEO_CREW_CLAUDE_SEAT: seatPath }, ["--setting-sources=user,project,local", "--settings", paseo, "--model", "opus"]), 0);
  const { config, argv } = JSON.parse(readFileSync(launched, "utf-8"));
  assert.equal(config, null, "no config dir of its own, so no login of its own");
  assert.deepEqual(argv.filter((_: string, i: number) => i !== 2), ["--setting-sources=", "--settings", "--model", "opus", "--strict-mcp-config", "--plugin-dir", join(seatPath, "crew")]);
  assert.deepEqual(JSON.parse(argv[2]), { language: "vietnamese", permissions: { deny: ["WebFetch"] }, sandbox: { enabled: true, filesystem: { allowWrite: ["/state/x"] } }, fastMode: false });
});

test("a Claude seat Paseo passes no settings to still gets its own", async () => {
  const { seatPath, launched, env } = claudeSeat();
  assert.equal(await launch({ ...env, PASEO_CREW_CLAUDE_SEAT: seatPath }, ["--model", "opus"]), 0);
  assert.deepEqual(JSON.parse(readFileSync(launched, "utf-8")).argv, ["--model", "opus", "--settings", join(seatPath, "settings.json"), "--strict-mcp-config", "--plugin-dir", join(seatPath, "crew"), "--setting-sources", ""]);
});

test("a Claude launch the plugin did not configure is refused before it reaches the owner's settings", async () => {
  const { launched, env } = claudeSeat();
  assert.equal(await launch(env, ["--model", "opus"]), 2);
  assert.equal(existsSync(launched), false);
});
