import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tempDir } from "../tempdir.ts";

const SEAT_ROOM = fileURLToPath(new URL("../../bin/seat-room", import.meta.url));
const PLUGIN = fileURLToPath(new URL("../..", import.meta.url));

function open(env: Record<string, string>, args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(SEAT_ROOM, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

const acme = tempDir("sw2-seat-room-kit-");
mkdirSync(join(acme, "harness", "acme"), { recursive: true });
writeFileSync(
  join(acme, "harness", "acme", "harness.json"),
  JSON.stringify({ configDirEnv: "ACME_HOME", provider: { command: ["KIT/bin/seat-room"] } }),
);
const ROWS: [string, string, string, string, string | undefined, string[], number, string | null][] = [
  ["a launch the plugin did not configure", acme, "acme", "ACME_HOME", undefined, ["--print"], 2, null],
  ["one with no arguments", acme, "acme", "ACME_HOME", undefined, [], 2, null],
  [
    "one asking the version among other things",
    acme,
    "acme",
    "ACME_HOME",
    undefined,
    ["--version", "--print"],
    2,
    null,
  ],
  [
    "Paseo asking the version for its model catalog, which starts no session",
    acme,
    "acme",
    "ACME_HOME",
    undefined,
    ["--version"],
    0,
    " --version\n",
  ],
  [
    "a seat the plugin configured",
    acme,
    "acme",
    "ACME_HOME",
    "/seats/acme-peer",
    ["--print"],
    0,
    "/seats/acme-peer --print\n",
  ],
  [
    "a Claude seat, whose settings come from its seat alone",
    PLUGIN,
    "claude",
    "CLAUDE_CONFIG_DIR",
    "/seats/claude-peer",
    ["-p"],
    0,
    "/seats/claude-peer -p --setting-sources user\n",
  ],
  [
    "whatever setting sources its caller names",
    PLUGIN,
    "claude",
    "CLAUDE_CONFIG_DIR",
    "/seats/claude-peer",
    ["--setting-sources", "project,local", "-p"],
    0,
    "/seats/claude-peer --setting-sources user -p\n",
  ],
  [
    "and however it names them",
    PLUGIN,
    "claude",
    "CLAUDE_CONFIG_DIR",
    "/seats/claude-peer",
    ["--setting-sources=project", "-p"],
    0,
    "/seats/claude-peer --setting-sources=user -p\n",
  ],
];

test("the seat room starts the agent only on the seat's own settings and with the flags its agent is forced to take, and answers Paseo's version probe unconfigured", async () => {
  for (const [what, kit, harness, configDirEnv, configured, args, code, started] of ROWS) {
    const dir = tempDir("sw2-seat-room-");
    const launched = join(dir, "launched");
    const agent = join(dir, "agent");
    writeFileSync(agent, `#!/bin/sh\necho "$${configDirEnv} $*" > ${JSON.stringify(launched)}\n`);
    chmodSync(agent, 0o755);
    const env = { PATH: process.env.PATH!, SEATWORKS_KIT: kit, SEATWORKS_HARNESS: harness, SEATWORKS_AGENT_BIN: agent };
    const ran = await open(configured ? { ...env, [configDirEnv]: configured } : env, args);
    assert.equal(ran.code, code, `${what}: ${ran.stderr}`);
    assert.equal(existsSync(launched) ? readFileSync(launched, "utf-8") : null, started, what);
    if (!started)
      assert.match(
        ran.stderr,
        new RegExp(`^Seat room: ${configDirEnv} is unset, so this seat would run on your own settings`),
        what,
      );
  }
});
