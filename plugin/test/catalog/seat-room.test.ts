import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../tempdir.ts";

const SEAT_ROOM = new URL("../../bin/seat-room", import.meta.url).pathname;

function seat() {
  const dir = tempDir("sw2-seat-room-");
  mkdirSync(join(dir, "harness", "acme"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify({ configDirEnv: "ACME_HOME", provider: { command: ["KIT/bin/seat-room"] } }));
  const launched = join(dir, "launched");
  const agent = join(dir, "agent");
  // It records how it was started, with the settings directory it was given.
  writeFileSync(agent, `#!/bin/sh\necho "$ACME_HOME $*" > ${JSON.stringify(launched)}\n`);
  chmodSync(agent, 0o755);
  return { launched, env: { PATH: process.env.PATH!, SEATWORKS_KIT: dir, SEATWORKS_HARNESS: "acme", SEATWORKS_AGENT_BIN: agent } };
}

function open(env: Record<string, string>, args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(SEAT_ROOM, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("a launch the plugin did not configure is refused outright, and the agent never starts on the owner's own settings", async () => {
  for (const args of [["--print"], [], ["--version", "--print"]]) {
    const { launched, env } = seat();
    const { code, stderr } = await open(env, args);
    assert.equal(code, 2, args.join(" "));
    assert.equal(existsSync(launched), false);
    assert.match(stderr, /^Seat room: ACME_HOME is unset, so this seat would run on your own settings/);
  }
});

test("Paseo asking the agent's version for its model catalog is answered even unconfigured, since that starts no session", async () => {
  const { launched, env } = seat();
  const { code } = await open(env, ["--version"]);
  assert.equal(code, 0);
  assert.equal(readFileSync(launched, "utf-8"), " --version\n");
});

test("a seat the plugin configured starts the agent on its own settings", async () => {
  const { launched, env } = seat();
  const { code } = await open({ ...env, ACME_HOME: "/seats/acme-peer" }, ["--print"]);
  assert.equal(code, 0);
  assert.equal(readFileSync(launched, "utf-8"), "/seats/acme-peer --print\n");
});
